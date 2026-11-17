-- Reclassify the two verified gross shift deposits, without moving any cash.
-- Preserves original deposits, source withdrawals, ticket values and shift totals.
set local lock_timeout='5s';
do $$
declare s record; d jsonb; p jsonb; a jsonb; gross numeric; profit numeric; n int; rid text;
 before_cash text; before_wallets text; before_tickets text; available numeric; now_text text:=clock_timestamp()::text;
begin
 perform pg_advisory_xact_lock(hashtextextended('ammar_erp_financial_commit',0));
 select md5(coalesce(string_agg(data::text,',' order by id),'')) into before_cash from public.safe_transactions;
 select md5(coalesce(string_agg(data::text,',' order by id),'')) into before_wallets from public.store_wallets;
 select md5(coalesce(string_agg(data::text,',' order by id),'')) into before_tickets from public.tickets;
 insert into erp_private.release_backup(table_name,rows)
 select 'shift_profit_nov10_'||t.name,t.rows from (
 select 'store_wallet_transactions' name,coalesce(jsonb_agg(to_jsonb(x)),'[]') rows from public.store_wallet_transactions x
 union all select 'shift_settlements',coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.shift_settlements x
 union all select 'safe_transactions',coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.safe_transactions x
 ) t on conflict(table_name) do nothing;
 for s in select id,data from public.shift_settlements where id in ('settle_1794184587679','settle_1794185689696') order by id loop
  d:=s.data;rid:='legacy_shift_profit_'||s.id;
  if exists(select 1 from public.store_wallet_transactions where id=rid) then continue;end if;
  if d->>'status'<>'closed' or d->>'settlementMode' is not null or coalesce(d->>'_erpTestScope','')<>'' then raise exception 'unexpected_legacy_shift';end if;
  select coalesce(sum((data->>'amount')::numeric),0),count(*) into gross,n from public.safe_transactions
   where d->'safeTransactionIds' ? id and data->>'type'='cash_in' and data->>'category'='shift_settlement' and data->>'currency'='EGP';
  if n<>jsonb_array_length(d->'safeTransactionIds') or gross<>(d->>'totalTransferredEGP')::numeric or gross<>(d->>'totalRevenue')::numeric then raise exception 'legacy_cash_evidence_changed';end if;
  if exists(select 1 from public.store_wallet_transactions where data->>'walletId'='w_profits' and data->>'sourceType' in ('manual_withdrawal','transfer') and coalesce((data->>'amount')::numeric,0)>0 and data->>'sourceName' is distinct from 'legacy_shift_profit_allocation' and coalesce(data->>'_erpTestScope','')='') then raise exception 'manual_profit_payment_needs_separate_review';end if;
  select count(*),round(sum(coalesce((data->>'netProfit')::numeric,(data->>'totalProfitMargin')::numeric,0)),2),
   jsonb_object_agg(id,coalesce((data->>'netProfit')::numeric,(data->>'totalProfitMargin')::numeric,0)),
   jsonb_build_object('goods',round(sum(coalesce((data->>'totalCostAmount')::numeric,0)),2),
    'cashback',round(sum(coalesce((data->>'cashbackEarned')::numeric,0)),2),'referrals',round(sum(coalesce((data->>'referralCommissionEarned')::numeric,0)),2),
    'expenses',round(sum(coalesce((data->>'fixedCostAmount')::numeric,0)),2),'trust',round(sum(coalesce((data->>'overpaymentAmount')::numeric,0)),2))
   into n,profit,p,a from public.tickets where d->'ticketIds' ? id and data->>'status'='completed' and data->'refundDetails' is null;
  if n<>jsonb_array_length(d->'ticketIds') or profit<=0 or profit>gross then raise exception 'legacy_ticket_evidence_changed';end if;
  available:=erp_private.profit_available('w_profits','');
  insert into public.store_wallet_transactions(id,data) values(rid,jsonb_build_object('id',rid,'walletId','w_profits','walletName','محفظة الأرباح الصافية',
    'type','withdrawal','amount',profit,'currency','EGP','balanceBefore',available,'balanceAfter',available-profit,
    'description','تخصيص الربح الموجود بالفعل ضمن تحويل الوردية السابق — دون حركة نقد جديدة',
    'sourceType','manual_withdrawal','sourceName','legacy_shift_profit_allocation','referenceNumber','LEGACY-SHIFT-PROFIT:'||s.id,
    'legacySettlementId',s.id,'targetWalletId','vault_main','profitTicketAllocations',p,'createdAt',now_text,
    'notes','تصحيح تصنيف تحويل سابق؛ أصل التحويل ونقد الخزنة ومحافظ الاستقبال والتذاكر لم تتغير'));
  update public.shift_settlements set data=data||jsonb_build_object('legacyProfitAllocationId',rid,'legacyAllocation',a||jsonb_build_object(
   'grossCashAlreadyTransferred',gross,'netProfit',profit,'otherAllocations',gross-profit,'allocatedAt',now_text)),updated_at=clock_timestamp() where id=s.id;
 end loop;
 if before_cash<>(select md5(coalesce(string_agg(data::text,',' order by id),'')) from public.safe_transactions)
 or before_wallets<>(select md5(coalesce(string_agg(data::text,',' order by id),'')) from public.store_wallets)
 or before_tickets<>(select md5(coalesce(string_agg(data::text,',' order by id),'')) from public.tickets) then raise exception 'unexpected_cash_or_ticket_mutation';end if;
end $$;
select round(sum((data->>'amount')::numeric),2) allocated_profit, count(*) classified_shifts,
 erp_private.profit_available('w_profits','') remaining_profit
from public.store_wallet_transactions where data->>'sourceName'='legacy_shift_profit_allocation';
