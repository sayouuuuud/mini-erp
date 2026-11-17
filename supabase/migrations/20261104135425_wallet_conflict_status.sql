-- Use an explicit application conflict (409), not a retryable database serialization error.
create or replace function erp_private.commit_changes(p_operation_id uuid,p_changes jsonb) returns jsonb
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
   raise exception using errcode='PT409',message='erp_conflict',detail=t||':'||rid;
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
notify pgrst,'reload schema';
