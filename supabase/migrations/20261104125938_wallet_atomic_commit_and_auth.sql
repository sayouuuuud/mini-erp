-- Ammar ERP: protected backup, Auth migration and a single transactional write boundary.
-- Existing financial rows are backed up, not rewritten by this migration.
create schema if not exists erp_private;
revoke all on schema erp_private from public, anon;
grant usage on schema erp_private to authenticated;
create table erp_private.release_backup (table_name text primary key, rows jsonb not null, captured_at timestamptz not null default now());
alter table erp_private.release_backup enable row level security;
revoke all on erp_private.release_backup from public, anon, authenticated;
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='public' loop
  execute format('insert into erp_private.release_backup(table_name,rows) select %L,coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from public.%I x',t.tablename,t.tablename);
 end loop;
end $$;
create table erp_private.entities(table_name text primary key);
alter table erp_private.entities enable row level security;
insert into erp_private.entities select table_name from information_schema.columns where table_schema='public' and column_name in ('data','value') group by table_name;
create table erp_private.members(auth_id uuid primary key references auth.users(id) on delete cascade, user_id text unique not null, test_scope text not null default '');
alter table erp_private.members enable row level security;
create table erp_private.commit_receipts(operation_id uuid primary key, actor uuid not null, payload_hash text not null, result jsonb not null, created_at timestamptz not null default now());
alter table erp_private.commit_receipts enable row level security;
revoke all on all tables in schema erp_private from public, anon, authenticated;

create function erp_private.sync_identity(p_user jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare aid uuid; login_email text; pass text := p_user->>'password'; begin
 if nullif(trim(p_user->>'username'),'') is null then raise exception 'username_required'; end if;
 login_email := encode(extensions.digest(lower(trim(p_user->>'username')),'sha256'),'hex')||'@erp.ammar.invalid';
 select auth_id into aid from erp_private.members where user_id=p_user->>'id';
 if aid is null then
  if coalesce(length(pass),0)<6 then raise exception 'password_minimum_6'; end if;
  aid := gen_random_uuid();
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
   values('00000000-0000-0000-0000-000000000000',aid,'authenticated','authenticated',login_email,extensions.crypt(pass,extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}',now(),now(),'','','','');
  insert into auth.identities(user_id,provider_id,identity_data,provider,created_at,updated_at)
   values(aid,aid::text,jsonb_build_object('sub',aid::text,'email',login_email,'email_verified',true),'email',now(),now());
  insert into erp_private.members(auth_id,user_id) values(aid,p_user->>'id');
 else
  update auth.users set email=login_email,updated_at=now(),encrypted_password=case when nullif(pass,'') is not null then extensions.crypt(pass,extensions.gen_salt('bf')) else encrypted_password end where id=aid;
  update auth.identities set identity_data=identity_data||jsonb_build_object('email',login_email),updated_at=now() where user_id=aid and provider='email';
  if nullif(pass,'') is not null then delete from auth.sessions where user_id=aid; end if;
 end if;
 return aid;
end $$;
revoke all on function erp_private.sync_identity(jsonb) from public,anon,authenticated;
-- Preserve the configured credential. No universal/demo password is introduced.
do $$ declare profile_row record; begin
 for profile_row in select data from public.users where coalesce(length(data->>'password'),0)>=6 loop
  perform erp_private.sync_identity(profile_row.data);
 end loop;
 if not exists(select 1 from erp_private.members m join public.users u on u.id=m.user_id where u.data->>'role'='admin') then raise exception 'configured_admin_required'; end if;
end $$;

create function erp_private.actor() returns jsonb
language sql stable security definer set search_path='' as $$
 select (u.data-'password')||jsonb_build_object('_testScope',m.test_scope)
 from erp_private.members m join public.users u on u.id=m.user_id
 where m.auth_id=(select auth.uid()) and coalesce((u.data->>'isActive')::boolean,false)
 and exists(select 1 from auth.sessions s where s.id::text=(select auth.jwt()->>'session_id') and s.user_id=m.auth_id)
$$;
create function public.erp_current_user() returns jsonb language sql stable security invoker set search_path='' as $$ select erp_private.actor() $$;
revoke all on function erp_private.actor(),public.erp_current_user() from public,anon;
grant execute on function erp_private.actor(),public.erp_current_user() to authenticated;

create function erp_private.can_read(t text, row_id text, d jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare a jsonb := erp_private.actor(); scope text; begin
 if a is null then return false; end if;
 scope:=coalesce(a->>'_testScope','');
 if t='system_kv' then
  if scope<>'' then return starts_with(row_id,scope||':'); end if;
  return not starts_with(row_id,'__qa_') and row_id not in ('current_user','nzm_jkr_current_user');
 end if;
 if coalesce(d->>'_erpTestScope','')<>scope then return false; end if;
 if t='users' then return a->>'role'='admin' or row_id=a->>'id'; end if;
 if a->>'role'='admin' then return true; end if;
 if t like 'dealer_%' or t in ('dealers','merchants') or t like 'merchant_%' or t like 'middleman_%' or t like 'subscription%' or t like 'competition%' then return false; end if;
 return coalesce(a->'permissions','[]'::jsonb) ? 'view';
end $$;
revoke all on function erp_private.can_read(text,text,jsonb) from public,anon;
grant execute on function erp_private.can_read(text,text,jsonb) to authenticated;

create function erp_private.profit_available(p_wallet text,p_scope text) returns numeric
language plpgsql stable security definer set search_path='' as $$
declare earned numeric; moved numeric; begin
 if p_wallet='w_profits' then
  select coalesce(sum(round(coalesce((data->>'netProfit')::numeric,(data->>'totalProfitMargin')::numeric,0)*case when coalesce((data->>'receivedAmount')::numeric,0)>0 then greatest(0,1-coalesce((data#>>'{refundDetails,amount}')::numeric,0)/(data->>'receivedAmount')::numeric) else 1 end,2)),0) into earned
   from public.tickets where data->>'status'='completed' and coalesce(data->>'_erpTestScope','')=p_scope;
 else
  select coalesce(sum(round(coalesce((data->>'netProfit')::numeric,(data->>'totalProfitMargin')::numeric,0)*case when coalesce((data->>'receivedAmount')::numeric,0)>0 then greatest(0,1-coalesce((data#>>'{refundDetails,amount}')::numeric,0)/(data->>'receivedAmount')::numeric) else 1 end,2)),0) into earned
   from public.dealer_tickets where data->>'status'='completed' and coalesce(data->>'_erpTestScope','')=p_scope;
 end if;
 select coalesce(sum(case when x->>'type' in ('withdrawal','transfer_out') then -abs((x->>'amount')::numeric) when x->>'type' in ('deposit','transfer_in') then abs((x->>'amount')::numeric) else 0 end),0) into moved
 from (select data x from public.store_wallet_transactions union all select data from public.dealer_wallet_transactions) q
 where x->>'walletId'=p_wallet and coalesce(x->>'_erpTestScope','')=p_scope and
 (x->>'sourceType' in ('manual_withdrawal','manual_deposit','transfer','opening_balance') or (not(x?'sourceType') and x->>'type' in ('withdrawal','transfer_out','transfer_in')));
 return round(earned+moved,2);
end $$;
revoke all on function erp_private.profit_available(text,text) from public,anon,authenticated;

create function erp_private.commit_changes(p_operation_id uuid,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb:=erp_private.actor(); scope text; c jsonb; t text; rid text; actual jsonb; found_row boolean; next_data jsonb;
 hash text:=md5(p_changes::text); receipt erp_private.commit_receipts%rowtype; result jsonb; has_ticket boolean;
begin
 if a is null then raise exception using errcode='42501',message='erp_auth_required'; end if;
 if jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>2000 then raise exception 'invalid_batch'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ammar_erp_financial_commit',0));
 select * into receipt from erp_private.commit_receipts where operation_id=p_operation_id;
 if found then
  if receipt.actor<>(select auth.uid()) or receipt.payload_hash<>hash then raise exception 'operation_id_reused'; end if;
  return receipt.result;
 end if;
 scope:=coalesce(a->>'_testScope','');
 has_ticket:=exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table' in ('tickets','dealer_tickets'));
 -- Validate the entire expected state BEFORE writing a single row.
 for c in select value from jsonb_array_elements(p_changes) loop
  t:=c->>'table'; rid:=c->>'id';
  if not exists(select 1 from erp_private.entities where table_name=t) or nullif(rid,'') is null then raise exception 'invalid_entity'; end if;
  if a->>'role'<>'admin' then
   if t='users' or t='system_kv' and (rid like '%settings%' or rid like '%config%') then raise exception using errcode='42501',message='erp_admin_required'; end if;
   if c->'after'='null'::jsonb and not(coalesce(a->'permissions','[]')?'delete') then raise exception using errcode='42501',message='erp_delete_denied'; end if;
   if not (coalesce(a->'permissions','[]') ? case when coalesce((c->>'exists')::boolean,false) then 'edit' else 'add' end) then raise exception using errcode='42501',message='erp_write_denied'; end if;
   if t like 'dealer_%' or t in ('dealers','merchants') or t like 'merchant_%' or t like 'middleman_%' or t like 'subscription%' or t like 'competition%' then raise exception using errcode='42501',message='erp_department_denied'; end if;
   if not has_ticket and t in ('store_wallets','store_wallet_transactions','safe_transactions','expenses','debts','balance_withdrawals') and not(coalesce(a->'permissions','[]')?'manage_finance') then raise exception using errcode='42501',message='erp_finance_denied'; end if;
  end if;
  if t='system_kv' then
   if rid in ('current_user','nzm_jkr_current_user') then raise exception 'session_is_not_data'; end if;
   if scope<>'' then rid:=scope||':'||rid; elsif starts_with(rid,'__qa_') then raise exception 'invalid_scope'; end if;
   select value into actual from public.system_kv where key=rid for update; found_row:=found;
  else
   execute format('select data from public.%I where id=$1 for update',t) into actual using rid;
   -- Dynamic EXECUTE does not set FOUND.
   found_row:=actual is not null;
   if found_row and coalesce(actual->>'_erpTestScope','')<>scope then raise exception using errcode='42501',message='erp_scope_denied'; end if;
  end if;
  if found_row<>coalesce((c->>'exists')::boolean,false) or (found_row and actual is distinct from c->'before') then
   raise exception using errcode='40001',message='erp_conflict',detail=t||':'||rid;
  end if;
 end loop;
 for c in select value from jsonb_array_elements(p_changes) loop
  t:=c->>'table'; rid:=c->>'id'; next_data:=c->'after';
  if t='system_kv' then
   if scope<>'' then rid:=scope||':'||rid; end if;
   if next_data='null'::jsonb then delete from public.system_kv where key=rid;
   else insert into public.system_kv(key,value,updated_at) values(rid,next_data,now()) on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at; end if;
  else
   if next_data='null'::jsonb then
    if t='users' then delete from auth.users where id=(select auth_id from erp_private.members where user_id=rid); end if;
    execute format('delete from public.%I where id=$1',t) using rid;
   else
    if next_data->>'id' is distinct from rid then raise exception 'row_id_mismatch'; end if;
    if scope<>'' then next_data:=next_data||jsonb_build_object('_erpTestScope',scope); else next_data:=next_data-'_erpTestScope'; end if;
    if t='users' then
     if nullif(next_data->>'password','') is not null or not exists(select 1 from erp_private.members where user_id=rid) then perform erp_private.sync_identity(next_data); end if;
     next_data:=(next_data-'password')||jsonb_build_object('hasPassword',true);
    end if;
    execute format('insert into public.%I(id,data,updated_at) values($1,$2,now()) on conflict(id) do update set data=excluded.data,updated_at=excluded.updated_at',t) using rid,next_data;
   end if;
  end if;
 end loop;
 -- A fresh withdrawal must be funded and a profit transfer must have its destination
 -- in this same transaction. Historical reversal records never fund withdrawals.
 for c in select value from jsonb_array_elements(p_changes) where value->>'table'='store_wallet_transactions' and not coalesce((value->>'exists')::boolean,false) and value->'after'<>'null'::jsonb loop
  next_data:=c->'after';
  if next_data->>'walletId' in ('w_profits','mw_profits') and next_data->>'sourceType' in ('manual_withdrawal','transfer') and next_data->>'type' in ('withdrawal','transfer_out') then
   if a->>'role'<>'admin' then raise exception using errcode='42501',message='erp_admin_required'; end if;
   if coalesce((next_data->>'amount')::numeric,0)<=0 or erp_private.profit_available(next_data->>'walletId',scope)<0 then raise exception 'erp_insufficient_profit'; end if;
   if next_data->>'sourceName'='profit_transfer' and not exists(
    select 1 from jsonb_array_elements(p_changes) x where x->'after'<>'null'::jsonb and (
     (x->>'table'=case when next_data->>'walletId'='mw_profits' then 'dealer_safe_transactions' else 'safe_transactions' end and x#>>'{after,referenceId}'=next_data->>'referenceNumber' and x#>>'{after,type}'='cash_in' and (x#>>'{after,amount}')::numeric=(next_data->>'amount')::numeric)
     or (x->>'table'='store_wallet_transactions' and x#>>'{after,walletId}'=next_data->>'targetWalletId' and x#>>'{after,referenceNumber}'=next_data->>'referenceNumber' and x#>>'{after,type}' in ('deposit','transfer_in') and (x#>>'{after,amount}')::numeric=(next_data->>'amount')::numeric))) then raise exception 'erp_transfer_destination_missing'; end if;
  end if;
 end loop;
 result:=jsonb_build_object('operationId',p_operation_id,'committedAt',clock_timestamp(),'changes',jsonb_array_length(p_changes));
 insert into erp_private.commit_receipts(operation_id,actor,payload_hash,result) values(p_operation_id,(select auth.uid()),hash,result);
 return result;
end $$;
revoke all on function erp_private.commit_changes(uuid,jsonb) from public,anon;
grant execute on function erp_private.commit_changes(uuid,jsonb) to authenticated;
create function public.erp_commit_changes(p_operation_id uuid,p_changes jsonb) returns jsonb
language sql security invoker set search_path='' as $$select erp_private.commit_changes(p_operation_id,p_changes)$$;
revoke all on function public.erp_commit_changes(uuid,jsonb) from public,anon;
grant execute on function public.erp_commit_changes(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
