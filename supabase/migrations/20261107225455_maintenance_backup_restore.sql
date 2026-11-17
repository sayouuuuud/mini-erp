-- Dedicated, admin-only, atomic maintenance. Does not execute any reset/restore on installation.
-- Identity tables and live authentication sessions are deliberately outside application backups.
create or replace function erp_private.backup_key_allowed(k text) returns boolean
language sql immutable security invoker set search_path='' as $$
 select k ~ '^[a-zA-Z0-9_]+$' and k !~* '(password|token|session|credential|^sb_|^__qa_|^jkr_wallet_lock_)'
 and k <> all(array['users','current_user','auth_user','current_dept','theme','font_size','active_tabs','active_tab_id','sidebar_groups'])
$$;
revoke all on function erp_private.backup_key_allowed(text) from public,anon,authenticated;

create or replace function erp_private.business_snapshot(p_scope text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t text; rows jsonb; tables jsonb:='{}'; kv jsonb;
begin
 for t in select table_name from erp_private.entities where table_name not in ('users','system_kv') order by table_name loop
  execute format('select coalesce(jsonb_agg(data order by id),''[]'') from public.%I where coalesce(data->>''_erpTestScope'','''')=$1',t) into rows using p_scope;
  tables:=tables||jsonb_build_object(t,rows);
 end loop;
 select coalesce(jsonb_object_agg(logical_key,value),'{}') into kv from (
  select distinct on (logical_key) logical_key,value from (
   select regexp_replace(case when p_scope<>'' then substr(key,length(p_scope)+2) else key end,'^nzm_jkr_','') logical_key,value,updated_at,
    case when p_scope<>'' then substr(key,length(p_scope)+2) else key end original_key
   from public.system_kv where case when p_scope<>'' then starts_with(key,p_scope||':') else not starts_with(key,'__qa_') end
  ) raw where erp_private.backup_key_allowed(logical_key)
  order by logical_key,starts_with(original_key,'nzm_jkr_') desc,updated_at desc
 ) selected;
 return jsonb_build_object('tables',tables,'kv',kv,'replaceKv',true);
end $$;
revoke all on function erp_private.business_snapshot(text) from public,anon,authenticated;

create or replace function erp_private.export_backup() returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb:=erp_private.actor(); snapshot jsonb;
begin
 if a->>'role' is distinct from 'admin' then raise exception using errcode='42501',message='erp_admin_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ammar_erp_financial_commit',0));
 snapshot:=erp_private.business_snapshot(coalesce(a->>'_testScope',''));
 return snapshot||jsonb_build_object('format','erp-cloud-backup','version','4.0','systemName','NZM JKR ERP','exportedAt',clock_timestamp(),'revision',md5(snapshot::text));
end $$;
revoke all on function erp_private.export_backup() from public,anon;
grant execute on function erp_private.export_backup() to authenticated;
create or replace function public.erp_export_backup() returns jsonb
language sql security invoker set search_path='' as $$select erp_private.export_backup()$$;
revoke all on function public.erp_export_backup() from public,anon;
grant execute on function public.erp_export_backup() to authenticated;

create or replace function erp_private.maintain_data(p_operation_id uuid,p_action text,p_payload jsonb,p_expected_revision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb:=erp_private.actor(); scope text; snapshot jsonb; receipt erp_private.commit_receipts%rowtype;
 hash text:=md5(jsonb_build_object('action',p_action,'payload',p_payload,'expected',p_expected_revision)::text);
 t text; k text; v jsonb; row_data jsonb; rid text; foreign_row boolean; result jsonb;
 finance_tables text[]:=array['safe_transactions','expenses','debts','shift_settlements','attendance','salaries','employees','daily_closures','balance_withdrawals',
 'dealer_safe_transactions','dealer_expenses','dealer_debts','dealer_settlements','dealer_attendance','dealer_salaries','dealer_employees','dealer_daily_closures','dealer_balance_withdrawals'];
begin
 if a->>'role' is distinct from 'admin' then raise exception using errcode='42501',message='erp_admin_required'; end if;
 if p_action not in ('restore','wipe_all','wipe_finance') or p_action is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>52428800 then raise exception 'erp_invalid_maintenance'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ammar_erp_financial_commit',0));
 select * into receipt from erp_private.commit_receipts where operation_id=p_operation_id;
 if found then
  if receipt.actor<>(select auth.uid()) or receipt.payload_hash<>hash then raise exception 'operation_id_reused'; end if;
  return receipt.result;
 end if;
 scope:=coalesce(a->>'_testScope','');
 snapshot:=erp_private.business_snapshot(scope);
 if p_expected_revision is distinct from md5(snapshot::text) then raise exception using errcode='PT409',message='erp_maintenance_conflict'; end if;
 if p_action='restore' then
  if jsonb_typeof(p_payload->'tables') is distinct from 'object' or jsonb_typeof(p_payload->'kv') is distinct from 'object'
   or (p_payload->'tables'='{}'::jsonb and p_payload->'kv'='{}'::jsonb) then raise exception 'erp_invalid_backup'; end if;
  -- Validate every table and ID before replacing any data; no writes to users/Auth.
  for t,v in select key,value from jsonb_each(p_payload->'tables') loop
   if t in ('users','system_kv') or not exists(select 1 from erp_private.entities where table_name=t) or jsonb_typeof(v)<>'array' then raise exception 'erp_invalid_backup_table'; end if;
   if exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'id') is distinct from 'string' or nullif(x->>'id','') is null)
    or (select count(*) from jsonb_array_elements(v))<>(select count(distinct x->>'id') from jsonb_array_elements(v) x) then raise exception 'erp_invalid_backup_ids'; end if;
   execute format('select exists(select 1 from public.%I where id in (select x->>''id'' from jsonb_array_elements($1) x) and coalesce(data->>''_erpTestScope'','''')<>$2)',t) into foreign_row using v,scope;
   if foreign_row then raise exception using errcode='42501',message='erp_scope_denied'; end if;
  end loop;
  for k in select jsonb_object_keys(p_payload->'kv') loop
   if not erp_private.backup_key_allowed(k) or starts_with(k,'nzm_jkr_') then raise exception 'erp_invalid_backup_key'; end if;
  end loop;
 end if;
 -- Retained privately before every successful maintenance operation, in the same transaction.
 insert into erp_private.release_backup(table_name,rows) values('maintenance:'||p_operation_id::text,jsonb_build_object('actor',a->>'id','action',p_action,'scope',scope,'snapshot',snapshot));
 if p_action='restore' then
  for t,v in select key,value from jsonb_each(p_payload->'tables') loop
   execute format('delete from public.%I where coalesce(data->>''_erpTestScope'','''')=$1',t) using scope;
   for row_data in select value from jsonb_array_elements(v) loop
    rid:=row_data->>'id';row_data:=row_data-'_erpTestScope';
    if scope<>'' then row_data:=row_data||jsonb_build_object('_erpTestScope',scope); end if;
    execute format('insert into public.%I(id,data,updated_at) values($1,$2,now())',t) using rid,row_data;
   end loop;
  end loop;
  if coalesce((p_payload->>'replaceKv')::boolean,false) then
   delete from public.system_kv where case when scope<>'' then starts_with(key,scope||':') else not starts_with(key,'__qa_') end
    and erp_private.backup_key_allowed(regexp_replace(case when scope<>'' then substr(key,length(scope)+2) else key end,'^nzm_jkr_',''));
  end if;
  for k,v in select key,value from jsonb_each(p_payload->'kv') loop
   foreach rid in array array[k,'nzm_jkr_'||k] loop
    if scope<>'' then rid:=scope||':'||rid; end if;
    insert into public.system_kv(key,value,updated_at) values(rid,v,now()) on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
   end loop;
  end loop;
 elsif p_action='wipe_all' then
  for t in select table_name from erp_private.entities where table_name not in ('users','system_kv') loop
   execute format('delete from public.%I where coalesce(data->>''_erpTestScope'','''')=$1',t) using scope;
  end loop;
  delete from public.system_kv where case when scope<>'' then starts_with(key,scope||':') else not starts_with(key,'__qa_') end
   and erp_private.backup_key_allowed(regexp_replace(case when scope<>'' then substr(key,length(scope)+2) else key end,'^nzm_jkr_',''));
  for k in select unnest(array['settings','exchange_rate','customer_module_settings','dealer_module_settings']) loop
   v:=coalesce(p_payload#>array['defaults',k],snapshot#>array['kv',k],'{}'::jsonb);
   if jsonb_typeof(v)<>'object' then raise exception 'erp_invalid_reset_defaults'; end if;
   if k='settings' then v:=v||jsonb_build_object('vaultInitialBalance',0); end if;
   foreach rid in array array[k,'nzm_jkr_'||k] loop
    if scope<>'' then rid:=scope||':'||rid; end if;
    insert into public.system_kv(key,value,updated_at) values(rid,v,now()) on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
   end loop;
  end loop;
 else
  foreach t in array finance_tables loop
   execute format('delete from public.%I where coalesce(data->>''_erpTestScope'','''')=$1',t) using scope;
  end loop;
  -- Treasury-only reset does not delete ticket contributions, operating wallets or FIFO.
  foreach k in array array['settings','system_settings','dealer_module_settings'] loop
   v:=coalesce(snapshot#>array['kv',k],'{}')||jsonb_build_object('vaultInitialBalance',0,'vaultInitialBalanceUSD',0);
   foreach rid in array array[k,'nzm_jkr_'||k] loop
    if scope<>'' then rid:=scope||':'||rid; end if;
    insert into public.system_kv(key,value,updated_at) values(rid,v,now()) on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
   end loop;
  end loop;
  foreach k in array array['shift_deficits','dealer_shift_deficits'] loop
   foreach rid in array array[k,'nzm_jkr_'||k] loop
    if scope<>'' then rid:=scope||':'||rid; end if;
    insert into public.system_kv(key,value,updated_at) values(rid,'[]',now()) on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
   end loop;
  end loop;
 end if;
 rid:='maintenance_'||p_operation_id::text;
 row_data:=jsonb_build_object('id',rid,'userId',a->>'id','userName',a->>'fullName','userRole','admin','department','الإعدادات',
  'actionType',case when p_action='restore' then 'restore_backup' else 'delete' end,'entityType','صيانة البيانات','entityId',p_operation_id,'entityTitle',p_action,
  'details','تمت العملية كاملة مع حفظ نسخة قبل التغيير والحفاظ على حسابات الدخول','timestamp',clock_timestamp());
 if scope<>'' then row_data:=row_data||jsonb_build_object('_erpTestScope',scope); end if;
 insert into public.audit_logs(id,data) values(rid,row_data);
 result:=jsonb_build_object('operationId',p_operation_id,'action',p_action,'committedAt',clock_timestamp());
 insert into erp_private.commit_receipts(operation_id,actor,payload_hash,result) values(p_operation_id,(select auth.uid()),hash,result);
 return result;
end $$;
revoke all on function erp_private.maintain_data(uuid,text,jsonb,text) from public,anon;
grant execute on function erp_private.maintain_data(uuid,text,jsonb,text) to authenticated;
create or replace function public.erp_maintain_data(p_operation_id uuid,p_action text,p_payload jsonb,p_expected_revision text) returns jsonb
language sql security invoker set search_path='' as $$select erp_private.maintain_data(p_operation_id,p_action,p_payload,p_expected_revision)$$;
revoke all on function public.erp_maintain_data(uuid,text,jsonb,text) from public,anon;
grant execute on function public.erp_maintain_data(uuid,text,jsonb,text) to authenticated;
notify pgrst,'reload schema';
