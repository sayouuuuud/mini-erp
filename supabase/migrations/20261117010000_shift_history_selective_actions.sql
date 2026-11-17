
-- Persistent selective history and immutable, server-captured shift evidence.
create table if not exists erp_private.action_history(
 id uuid primary key, actor uuid not null, scope text not null default '',
 description text not null, changes jsonb not null, state text not null default 'applied'
 check(state in ('applied','undone')), blocked_reason text,
 created_at timestamptz not null default clock_timestamp(), changed_at timestamptz not null default clock_timestamp());
alter table erp_private.action_history enable row level security;
create index if not exists action_history_actor_recent on erp_private.action_history(actor,scope,created_at desc,id desc);
revoke all on erp_private.action_history from public,anon,authenticated;
alter table erp_private.commit_receipts add column if not exists request_hash text;

create or replace function public.erp_commit_changes(p_operation_id uuid,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
#variable_conflict use_variable
declare a jsonb:=erp_private.actor(); scope text; c jsonb; changes jsonb:='[]'; snapshot jsonb; rec jsonb;
 result jsonb; receipt erp_private.commit_receipts%rowtype; description text; blocked text;
 originals jsonb:=p_changes; canonical jsonb:='[]'; relevant jsonb; starts text; ends text; financial jsonb;
begin
 if a is null then raise exception using errcode='42501',message='erp_auth_required';end if;
 if jsonb_typeof(p_changes)<>'array' then raise exception 'invalid_batch';end if;
 perform pg_advisory_xact_lock(hashtextextended('ammar_erp_financial_commit',0));
 select * into receipt from erp_private.commit_receipts where operation_id=p_operation_id;
 if found then
  if receipt.actor<>auth.uid() or coalesce(receipt.request_hash,receipt.payload_hash)<>md5(p_changes::text) then raise exception 'operation_id_reused';end if;
  return receipt.result;
 end if;
 scope:=coalesce(a->>'_testScope','');
 for c in select value from jsonb_array_elements(p_changes) loop
  if c->>'table' in ('shift_settlements','dealer_settlements') and coalesce((c->>'exists')::boolean,false)
   and c#>>'{before,status}' in ('closed','verified') and c->'before' is distinct from c->'after'
  then raise exception using errcode='PT409',message='سجل الوردية المغلقة ثابت ولا يمكن تغييره أو حذفه';end if;
  if c->>'table'='shift_settlements' and not coalesce((c->>'exists')::boolean,false) and c->'after'<>'null'::jsonb and c#>>'{after,status}' in ('closed','verified') then
   rec:=c->'after'; starts:=coalesce(rec->>'startTime','0001');ends:=coalesce(rec->>'endTime','9999');relevant:=coalesce(rec->'ticketIds','[]');
   select jsonb_build_object(
    'schemaVersion',1,'capturedAt',clock_timestamp(),'actor',jsonb_build_object('id',a->>'id','name',a->>'fullName'),
    'tickets',coalesce((select jsonb_agg(data order by id) from public.tickets where coalesce(data->>'_erpTestScope','')=scope and (relevant?id or (nullif(data->>'shiftSettlementId','') is null and coalesce(data->>'createdAt','')<=ends))),'[]'),
    'walletsBefore',coalesce((select jsonb_agg(data order by id) from public.store_wallets where coalesce(data->>'_erpTestScope','')=scope),'[]'),
    'walletTransactions',coalesce((select jsonb_agg(data order by data->>'createdAt',id) from public.store_wallet_transactions where coalesce(data->>'_erpTestScope','')=scope and (coalesce(data->>'createdAt','') between starts and ends or relevant?coalesce(data->>'ticketId',data->>'sourceId',data->>'referenceId',data->>'referenceNumber',''))),'[]'),
    'safeTransactions',coalesce((select jsonb_agg(data order by data->>'createdAt',id) from public.safe_transactions where coalesce(data->>'_erpTestScope','')=scope and coalesce(data->>'createdAt','') between starts and ends),'[]'),
    'expenses',coalesce((select jsonb_agg(data order by id) from public.expenses where coalesce(data->>'_erpTestScope','')=scope and coalesce(data->>'createdAt',data->>'date','') between starts and ends),'[]'),
    'debts',coalesce((select jsonb_agg(data order by id) from public.debts where coalesce(data->>'_erpTestScope','')=scope),'[]'),
    'withdrawals',coalesce((select jsonb_agg(data order by id) from public.balance_withdrawals where coalesce(data->>'_erpTestScope','')=scope and coalesce(data->>'createdAt','') between starts and ends),'[]'),
    'auditLogs',coalesce((select jsonb_agg(data order by data->>'createdAt',id) from public.audit_logs where coalesce(data->>'_erpTestScope','')=scope and coalesce(data->>'createdAt',data->>'timestamp','') between starts and ends),'[]'),
    'financialState',coalesce((select jsonb_object_agg(k.key,k.value) from public.system_kv k where (scope='' or starts_with(k.key,scope||':')) and regexp_replace(case when scope<>'' then substr(k.key,length(scope)+2) else k.key end,'^nzm_jkr_','') in ('jkr_wallets_v2','jkr_wallet_lots_v2','jkr_wallet_transactions_v2','jkr_wallet_consumptions_v2','jkr_wallet_losses_v2','jkr_wallet_adjustments_v2','shift_deficits','cust_tx','unified_wallet_transactions','referrals','cashback')),'{}'),
    'inventoryBonds',coalesce((select jsonb_agg(data order by id) from public.deposit_bonds_fifo where coalesce(data->>'_erpTestScope','')=scope),'[]'),
    'mainBalanceBefore',coalesce((select sum(case when data->>'type'='cash_in' then coalesce((data->>'amount')::numeric,0) when data->>'type'='cash_out' then -coalesce((data->>'amount')::numeric,0) else 0 end) from public.safe_transactions where coalesce(data->>'_erpTestScope','')=scope and coalesce(data->>'currency','EGP')='EGP'),0)
   ) into snapshot;
   c:=jsonb_set(c,'{after,auditSnapshot}',snapshot);
  end if;
  changes:=changes||jsonb_build_array(c);
 end loop;
 result:=erp_private.commit_changes(p_operation_id,changes);
 -- Capture the committed destination balances and actual journal legs in the same transaction.
 for c in select value from jsonb_array_elements(changes) where value->>'table'='shift_settlements' and not coalesce((value->>'exists')::boolean,false) and value#>'{after,auditSnapshot}' is not null loop
  rec:=c->'after';
  select jsonb_build_object(
   'walletsAfter',coalesce((select jsonb_agg(data order by id) from public.store_wallets where coalesce(data->>'_erpTestScope','')=scope),'[]'),
   'closingWalletTransactions',coalesce((select jsonb_agg(x->'after') from jsonb_array_elements(changes) x where x->>'table'='store_wallet_transactions' and x->'after'<>'null'::jsonb),'[]'),
   'closingSafeTransactions',coalesce((select jsonb_agg(x->'after') from jsonb_array_elements(changes) x where x->>'table'='safe_transactions' and x->'after'<>'null'::jsonb),'[]'),
   'mainBalanceAfter',coalesce((select sum(case when data->>'type'='cash_in' then coalesce((data->>'amount')::numeric,0) when data->>'type'='cash_out' then -coalesce((data->>'amount')::numeric,0) else 0 end) from public.safe_transactions where coalesce(data->>'_erpTestScope','')=scope and coalesce(data->>'currency','EGP')='EGP'),0)
  ) into financial;
  rec:=jsonb_set(rec,'{auditSnapshot}',rec->'auditSnapshot'||financial);
  update public.shift_settlements set data=rec where id=c->>'id';
  canonical:=canonical||jsonb_build_array(rec);
 end loop;
 result:=result||jsonb_build_object('settlements',canonical);
 update erp_private.commit_receipts set result=result,request_hash=md5(originals::text) where operation_id=p_operation_id;
 -- Immutable audit and notifications are not removed by a reversal.
 select coalesce(jsonb_agg(x),'[]') into financial from jsonb_array_elements(changes) x where x->>'table' not in ('audit_logs','notifications') and not(x->>'table'='system_kv' and (x->>'id' ~* '(counter|system_codes|wallet_lock_)'));
 if jsonb_array_length(financial)>0 then
  select coalesce(x#>>'{after,action}',x#>>'{after,description}') into description from jsonb_array_elements(changes) x where x->>'table'='audit_logs' and x->'after'<>'null'::jsonb limit 1;
  if description is null then
   select string_agg(distinct case x->>'table' when 'tickets' then 'تذاكر الشحن' when 'customers' then 'بيانات العملاء' when 'store_wallets' then 'المحافظ' when 'safe_transactions' then 'الخزنة' when 'expenses' then 'المصروفات' when 'shift_settlements' then 'تصفية وردية' when 'system_kv' then 'إعدادات النظام' else x->>'table' end,'، ') into description from jsonb_array_elements(financial) x;
   description:='تعديل: '||description;
  end if;
  if exists(select 1 from jsonb_array_elements(financial) x where (x->>'table'='users' or x->>'table'='system_kv' and x->>'id' ~* '(settings|config|password|token|session)')) then blocked:='هذا الإجراء يغيّر حسابات أو إعدادات نظام؛ يُعدّل من صفحته المخصصة';
  elsif exists(select 1 from jsonb_array_elements(financial) x where x->>'table' in ('shift_settlements','dealer_settlements')) then blocked:='الوردية المغلقة سجل مالي ثابت؛ تحتاج تسوية مستقلة';
  end if;
  insert into erp_private.action_history(id,actor,scope,description,changes,blocked_reason) values(p_operation_id,auth.uid(),scope,left(description,400),financial,blocked);
  delete from erp_private.action_history h0 where h0.actor=auth.uid() and h0.scope=scope and h0.id not in (select h.id from erp_private.action_history h where h.actor=auth.uid() order by h.created_at desc,h.id desc limit 10);
 end if;
 return result;
end $fn$;

create or replace function public.erp_action_history() returns jsonb language plpgsql security definer set search_path='' as $fn$
declare a jsonb:=erp_private.actor(); result jsonb;
begin
 if a is null then raise exception using errcode='42501',message='erp_auth_required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'description',h.description,'timestamp',h.created_at,'state',h.state,'blockedReason',h.blocked_reason) order by h.created_at desc,h.id desc),'[]') into result
 from erp_private.action_history h where h.actor=auth.uid() and h.scope=coalesce(a->>'_testScope','');
 return result;
end $fn$;

create or replace function public.erp_replay_action(p_action_id uuid,p_direction text,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare a jsonb:=erp_private.actor(); h erp_private.action_history%rowtype;c jsonb;changes jsonb:='[]';result jsonb;receipt erp_private.commit_receipts%rowtype;
begin
 if a is null then raise exception using errcode='42501',message='erp_auth_required';end if;
 if p_direction not in ('undo','redo') then raise exception 'invalid_direction';end if;
 perform pg_advisory_xact_lock(hashtextextended('ammar_erp_financial_commit',0));
 select * into receipt from erp_private.commit_receipts where operation_id=p_operation_id;
 if found then
  if receipt.actor<>auth.uid() or receipt.request_hash is distinct from md5(p_action_id::text||':'||p_direction) then raise exception 'operation_id_reused';end if;return receipt.result;
 end if;
 select * into h from erp_private.action_history where id=p_action_id and actor=auth.uid() and scope=coalesce(a->>'_testScope','') for update;
 if not found then raise exception using errcode='42501',message='الإجراء غير متاح لهذا الحساب أو خارج آخر 10 إجراءات';end if;
 if h.blocked_reason is not null then raise exception using errcode='PT409',message=h.blocked_reason;end if;
 if (p_direction='undo' and h.state<>'applied') or (p_direction='redo' and h.state<>'undone') then raise exception using errcode='PT409',message='تغيرت حالة الإجراء؛ حدّث القائمة';end if;
 for c in select value from jsonb_array_elements(h.changes) loop
  if p_direction='undo' then c:=jsonb_build_object('table',c->>'table','id',c->>'id','exists',c->'after'<>'null'::jsonb,'before',c->'after','after',c->'before');end if;
  changes:=changes||jsonb_build_array(c);
 end loop;
 -- Core rechecks every affected row and every financial invariant before any write.
 result:=erp_private.commit_changes(p_operation_id,changes);
 update erp_private.commit_receipts set request_hash=md5(p_action_id::text||':'||p_direction) where operation_id=p_operation_id;
 update erp_private.action_history set state=case when p_direction='undo' then 'undone' else 'applied' end,changed_at=clock_timestamp() where id=h.id;
 insert into public.audit_logs(id,data) values('history_'||p_operation_id,jsonb_build_object('id','history_'||p_operation_id,'userId',a->>'id','userName',a->>'fullName','action',case when p_direction='undo' then 'تراجع عن إجراء محدد' else 'إعادة إجراء محدد' end,'entityId',h.id,'details',h.description,'createdAt',clock_timestamp(),'_erpTestScope',h.scope));
 return result;
end $fn$;
revoke execute on function erp_private.commit_changes(uuid,jsonb) from public,anon,authenticated;
revoke execute on function public.erp_commit_changes(uuid,jsonb),public.erp_action_history(),public.erp_replay_action(uuid,text,uuid) from public,anon;
grant execute on function public.erp_commit_changes(uuid,jsonb),public.erp_action_history(),public.erp_replay_action(uuid,text,uuid) to authenticated;
