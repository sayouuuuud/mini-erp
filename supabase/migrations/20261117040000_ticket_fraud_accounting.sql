-- A fraud classification reverses fictitious cash, never delivered merchandise.
-- Called under the existing commit lock before any row is changed.
create or replace function erp_private.validate_ticket_fraud(p_changes jsonb,p_actor jsonb)
returns void language plpgsql security invoker set search_path='' as $fn$
declare c jsonb;t jsonb;old_t jsonb;r jsonb;w_change jsonb;old_w jsonb;new_w jsonb;old_n jsonb;new_n jsonb;
 scope text:=coalesce(p_actor->>'_testScope','');rid text;wallet_id text;line_ref text;reward_key text;
 cash numeric;amount numeric;total numeric;daily numeric;monthly numeric;n_total numeric;n_daily numeric;n_monthly numeric;n_count integer;
 day text:=to_char(clock_timestamp() at time zone 'Africa/Cairo','YYYY-MM-DD');mon text:=left(day,7);
 receipts jsonb;old_rewards jsonb;new_rewards jsonb;entry jsonb;replacement jsonb;key_name text;receipt_day text;
begin
 for c in select value from jsonb_array_elements(p_changes) where value->>'table' in ('tickets','dealer_tickets') loop
  t:=c->'after';old_t:=c->'before';rid:=c->>'id';
  if old_t->>'status'='fraud' and coalesce(t->>'status','')<>'fraud' then
   raise exception using errcode='PT409',message='لا يمكن إلغاء أثر الاحتيال أو إعادة البضاعة من مسار تذكرة عادي';
  end if;
  if coalesce(t->>'status','')<>'fraud' or old_t->>'status'='fraud' then continue;end if;
  if p_actor->>'role' not in ('admin','owner') then raise exception using errcode='42501',message='تسجيل الاحتيال متاح للمسؤول والمالك فقط';end if;
  if old_t is null or old_t='null'::jsonb or old_t->>'status' in ('refunded','canceled') or t#>>'{fraudDetails,accountingVersion}' is distinct from '1' or nullif(btrim(t#>>'{fraudDetails,reason}'),'') is null then
   raise exception using errcode='PT409',message='حدّث الموقع؛ تسجيل الاحتيال يتطلب عكس التحصيل والمكافآت مع حفظ البضاعة';
  end if;
  if t->'stockDeducted' is distinct from old_t->'stockDeducted' or t->'items' is distinct from old_t->'items' or t->'walletSnapshot' is distinct from old_t->'walletSnapshot' or t->'receivedAmount' is distinct from old_t->'receivedAmount' then
   raise exception using errcode='PT409',message='تسجيل الاحتيال لا يعيد البضاعة ولا يخصمها مجددًا ولا يغيّر قيمة الإيصال الأصلي';
  end if;
  if exists(select 1 from jsonb_array_elements(p_changes)x where x->>'table'='deposit_bonds_fifo' or (x->>'table'='system_kv' and regexp_replace(x->>'id','^nzm_jkr_','') in ('jkr_wallets_v2','jkr_wallet_lots_v2','jkr_wallet_consumptions_v2','jkr_wallet_transactions_v2','games_tree','first_shipping_games_tree') and x->'before' is distinct from x->'after')) then
   raise exception using errcode='PT409',message='رصيد البضاعة ودفعاتها وسجل استهلاكها ثابتة عند تسجيل الاحتيال';
  end if;
  select coalesce(jsonb_agg(tx.data),'[]') into receipts from public.store_wallet_transactions tx join public.store_wallets w on w.id=tx.data->>'walletId'
   where coalesce(tx.data->>'_erpTestScope','')=scope and coalesce(w.data->>'_erpTestScope','')=scope
    and w.data->>'type'='operating' and not coalesce((w.data->>'isSystemWallet')::boolean,false)
    and tx.data->>'type'='deposit' and tx.data->>'sourceType'='ticket'
    and (tx.data->>'sourceTicketId'=rid or tx.data->>'sourceTicketNumber' in (rid,t->>'ticketNumber') or tx.data->>'referenceNumber' in (rid,t->>'ticketNumber'));
  cash:=coalesce((t->>'receivedAmount')::numeric,0);
  if cash<0 or cash<>coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(receipts)x),0) or cash is distinct from (t#>>'{fraudDetails,cashReversed}')::numeric then raise exception using errcode='PT409',message='إلغاء التحصيل لا يطابق إيصالات التذكرة الأصلية';end if;
  for r in select value from jsonb_array_elements(receipts) loop
   if coalesce((r->>'amount')::numeric,0)<=0 then raise exception 'invalid_fraud_receipt';end if;
   -- Original receipts are immutable. A linked correcting journal must be new.
   if exists(select 1 from jsonb_array_elements(p_changes)x where x->>'table'='store_wallet_transactions' and x->>'id'=r->>'id') then raise exception 'fraud_receipt_changed';end if;
   select x->'after' into entry from jsonb_array_elements(p_changes)x where x->>'table'='store_wallet_transactions' and not coalesce((x->>'exists')::boolean,false) and x->>'id'='fraud:'||rid||':receipt:'||(r->>'id');
   if entry is null or entry->>'sourceType'<>'fraud' or entry->>'walletId' is distinct from r->>'walletId' or entry->>'sourceTicketId' is distinct from rid or (entry->>'amount')::numeric is distinct from (r->>'amount')::numeric then raise exception using errcode='PT409',message='سجل إلغاء التحصيل ناقص أو مكرر';end if;
  end loop;
  for wallet_id in select distinct value->>'walletId' from jsonb_array_elements(receipts) loop
   select value into w_change from jsonb_array_elements(p_changes) where value->>'table'='store_wallets' and value->>'id'=wallet_id;
   if w_change is null then raise exception 'fraud_cash_wallet_missing';end if;
   old_w:=w_change->'before';new_w:=w_change->'after';
   select sum((x->>'amount')::numeric) into total from jsonb_array_elements(receipts)x where x->>'walletId'=wallet_id;
   if jsonb_array_length(coalesce(old_w->'numbers','[]'))>0 then
    for old_n in select value from jsonb_array_elements(old_w->'numbers') loop
     select value into new_n from jsonb_array_elements(new_w->'numbers') where value->>'id'=old_n->>'id';
     if new_n is null then raise exception 'fraud_original_line_missing';end if;
     select coalesce(sum((x->>'amount')::numeric),0),coalesce(sum((x->>'amount')::numeric) filter(where to_char((x->>'createdAt')::timestamptz at time zone 'Africa/Cairo','YYYY-MM-DD')=day),0),coalesce(sum((x->>'amount')::numeric) filter(where to_char((x->>'createdAt')::timestamptz at time zone 'Africa/Cairo','YYYY-MM')=mon),0),count(*) into n_total,n_daily,n_monthly,n_count
      from jsonb_array_elements(receipts)x where x->>'walletId'=wallet_id and coalesce(x->>'walletNumberId',x->>'walletPhoneNumber',x->>'receivingPhoneNumber',t->>'paymentWalletNumberId',t->>'paymentReceivedPhone') in (old_n->>'id',old_n->>'phoneNumber');
     if coalesce((new_n->>'currentBalance')::numeric,0)<>coalesce((old_n->>'currentBalance')::numeric,0)-n_total
      or coalesce((new_n->>'dailyReceived')::numeric,0)<>greatest(0,(case when coalesce(old_w->>'lastDailyResetDate',day)=day then coalesce((old_n->>'dailyReceived')::numeric,0) else 0 end)-n_daily)
      or coalesce((new_n->>'monthlyReceived')::numeric,0)<>greatest(0,(case when coalesce(old_w->>'lastMonthlyResetMonth',mon)=mon then coalesce((old_n->>'monthlyReceived')::numeric,0) else 0 end)-n_monthly)
      or coalesce((new_n->>'totalReceived')::numeric,0)<>greatest(0,coalesce((old_n->>'totalReceived')::numeric,0)-n_total)
      or coalesce((new_n->>'dailySent')::numeric,0)<>(case when coalesce(old_w->>'lastDailyResetDate',day)=day then coalesce((old_n->>'dailySent')::numeric,0) else 0 end)
      or coalesce((new_n->>'monthlySent')::numeric,0)<>(case when coalesce(old_w->>'lastMonthlyResetMonth',mon)=mon then coalesce((old_n->>'monthlySent')::numeric,0) else 0 end)
      or coalesce((new_n->>'totalSent')::numeric,0)<>coalesce((old_n->>'totalSent')::numeric,0)
     then raise exception using errcode='PT409',message='إلغاء التحصيل أو حدود الخط لا يطابق الإيصال الأصلي؛ لن يُصرف مبلغ حقيقي';end if;
    end loop;
    if (select sum((x->>'currentBalance')::numeric) from jsonb_array_elements(new_w->'numbers')x) is distinct from (select sum((x->>'currentBalance')::numeric) from jsonb_array_elements(old_w->'numbers')x)-total then raise exception 'fraud_receiving_line_mismatch';end if;
   elsif (new_w->>'balance')::numeric is distinct from (old_w->>'balance')::numeric-total then raise exception 'fraud_cash_delta';end if;
  end loop;
  -- Earned benefits must be retained with their original amount but excluded.
  reward_key:=case when c->>'table'='dealer_tickets' then 'dealer_tx' else 'cashback' end;
  select value into old_rewards from public.system_kv where key=(case when scope='' then '' else scope||':' end)||reward_key;
  if old_rewards is null then select value into old_rewards from public.system_kv where key=(case when scope='' then '' else scope||':' end)||'nzm_jkr_'||reward_key;end if;
  for r in select value from jsonb_array_elements(coalesce(old_rewards,'[]')) where value->>'orderNumber' in (rid,t->>'ticketNumber') and (value->>'type' in ('earned','commission','credit','bonus') or (value->>'type'='adjustment' and coalesce((value->>'amount')::numeric,0)>0)) loop
   for entry in select value from jsonb_array_elements(p_changes) where value->>'table'='system_kv' and regexp_replace(value->>'id','^nzm_jkr_','')=reward_key loop
    select value into replacement from jsonb_array_elements(entry->'after') where value->>'id'=r->>'id';
    if replacement is null or replacement->>'fraudExcluded' is distinct from 'true' or replacement->'amount' is distinct from r->'amount' or replacement->'customerId' is distinct from r->'customerId' then raise exception 'fraud_reward_mismatch';end if;
   end loop;
   if not exists(select 1 from jsonb_array_elements(p_changes)x where x->>'table'='system_kv' and regexp_replace(x->>'id','^nzm_jkr_','')=reward_key) and r->>'fraudExcluded' is distinct from 'true' then raise exception using errcode='PT409',message='يجب إلغاء المكافآت والإحالات في نفس عملية تسجيل الاحتيال';end if;
  end loop;
 end loop;
end $fn$;
revoke execute on function erp_private.validate_ticket_fraud(jsonb,jsonb) from public,anon,authenticated;
do $patch$
declare definition text;marker text:=' perform erp_private.validate_inventory_refund(p_changes,a);';
begin
 select pg_get_functiondef('erp_private.commit_changes(uuid,jsonb)'::regprocedure) into definition;
 if position('validate_ticket_fraud' in definition)=0 then
  if position(marker in definition)=0 then raise exception 'unexpected_commit_definition';end if;
  execute replace(definition,marker,' perform erp_private.validate_ticket_fraud(p_changes,a);'||chr(10)||marker);
 end if;
end $patch$;
