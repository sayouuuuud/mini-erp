-- Reject an inventory refund that increases unbacked points. Older clients cannot
-- reintroduce the duplicate fallback after the corrected client is deployed.
create or replace function erp_private.validate_inventory_refund(p_changes jsonb,p_actor jsonb)
returns void language plpgsql security invoker set search_path='' as $fn$
declare scope text:=coalesce(p_actor->>'_testScope',''); before_wallets jsonb;after_wallets jsonb;before_lots jsonb;after_lots jsonb;before_tx jsonb;after_tx jsonb;
 w jsonb;b jsonb;l jsonb;old_lot jsonb;key_name text;actual jsonb;candidate jsonb;entry jsonb;old_sum numeric;new_sum numeric;old_excess numeric;new_excess numeric;check_refund boolean;
begin
 -- Fetch authoritative before-state and overlay only arrays in this same batch.
 for key_name in select unnest(array['jkr_wallets_v2','jkr_wallet_lots_v2','jkr_wallet_transactions_v2']) loop
  select value into actual from public.system_kv where key=case when scope='' then key_name else scope||':'||key_name end;
  if actual is null then select value into actual from public.system_kv where key=case when scope='' then 'nzm_jkr_'||key_name else scope||':nzm_jkr_'||key_name end;end if;
  actual:=coalesce(actual,'[]');
  candidate:=null;
  for entry in select value from jsonb_array_elements(p_changes) where value->>'table'='system_kv' and regexp_replace(value->>'id','^nzm_jkr_','')=key_name loop
   if candidate is not null and candidate is distinct from entry->'after' then raise exception using errcode='PT409',message='erp_inventory_alias_conflict';end if;
   candidate:=entry->'after';
  end loop;
  candidate:=coalesce(candidate,actual);
  if jsonb_typeof(candidate)<>'array' then return;end if; -- unrelated maintenance retains its own validation
  if key_name='jkr_wallets_v2' then before_wallets:=actual;after_wallets:=candidate;
  elsif key_name='jkr_wallet_lots_v2' then before_lots:=actual;after_lots:=candidate;
  else before_tx:=actual;after_tx:=candidate;end if;
 end loop;
 check_refund:=exists(select 1 from jsonb_array_elements(after_tx)t where t->>'referenceType'='TICKET' and t->>'transactionType' in ('REVERSAL','ADJUSTMENT') and coalesce((t->>'quantityIn')::numeric,0)>0 and not exists(select 1 from jsonb_array_elements(before_tx)old_tx where old_tx->>'id'=t->>'id'));
 if not check_refund then return;end if;
 for w in select value from jsonb_array_elements(after_wallets) where value->>'type'='SUB' loop
  select value into b from jsonb_array_elements(before_wallets) where value->>'id'=w->>'id';
  select coalesce(sum((x->>'remainingQuantity')::numeric),0) into old_sum from jsonb_array_elements(before_lots)x where x->>'walletId'=w->>'id' and x->>'currencyOrPoints'='POINTS';
  select coalesce(sum((x->>'remainingQuantity')::numeric),0) into new_sum from jsonb_array_elements(after_lots)x where x->>'walletId'=w->>'id' and x->>'currencyOrPoints'='POINTS';
  old_excess:=greatest(0,coalesce((b->>'pointsBalance')::numeric,0)-old_sum);
  new_excess:=greatest(0,coalesce((w->>'pointsBalance')::numeric,0)-new_sum);
  if new_excess>old_excess+0.0000001 then raise exception using errcode='PT409',message='استرداد النقاط مكرر أو لا يطابق رصيد دفعات البضاعة؛ حدّث الصفحة وأعد المحاولة';end if;
  for l in select value from jsonb_array_elements(after_lots) where value->>'walletId'=w->>'id' loop
   select value into old_lot from jsonb_array_elements(before_lots) where value->>'id'=l->>'id';
   if coalesce((l->>'remainingQuantity')::numeric,0)>coalesce((old_lot->>'remainingQuantity')::numeric,0)+0.0000001 and (
    old_lot is null or (l->>'initialQuantity')::numeric is distinct from (old_lot->>'initialQuantity')::numeric or
    (l->>'remainingQuantity')::numeric>(l->>'initialQuantity')::numeric+0.0000001)
   then raise exception using errcode='PT409',message='النقاط المرتجعة تتجاوز الدفعة الأصلية';end if;
  end loop;
 end loop;
end $fn$;
revoke execute on function erp_private.validate_inventory_refund(jsonb,jsonb) from public,anon,authenticated;
do $patch$
declare definition text;marker text:=' perform erp_private.validate_profit_loss_settlements(p_changes,a);';
begin
 select pg_get_functiondef('erp_private.commit_changes(uuid,jsonb)'::regprocedure) into definition;
 if position('validate_inventory_refund' in definition)=0 then
  if position(marker in definition)=0 then raise exception 'unexpected_commit_definition';end if;
  execute replace(definition,marker,' perform erp_private.validate_inventory_refund(p_changes,a);'||chr(10)||marker);
 end if;
end $patch$;
