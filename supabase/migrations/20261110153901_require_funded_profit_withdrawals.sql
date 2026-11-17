-- Every new retail profit payout must be backed by the same real cash debit.
-- No business rows are modified by this schema migration.
create or replace function erp_private.validate_profit_funding(p_changes jsonb,p_actor jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare c jsonb; d jsonb; source record; t record; prior jsonb; upcoming jsonb;
 scope text:=coalesce(p_actor->>'_testScope',''); total numeric; paid numeric; earned numeric; moved numeric; linked jsonb; ticket jsonb;
begin
 for c in select value from jsonb_array_elements(p_changes) where value->>'table'='store_wallet_transactions' loop
  d:=c->'after';
  if coalesce((c->>'exists')::boolean,false) and c#>>'{before,sourceName}'='profit_transfer' and c#>'{before,cashSourceAllocations}' is not null and d is distinct from c->'before' then raise exception 'erp_profit_payment_immutable'; end if;
  if coalesce((c->>'exists')::boolean,false) or d='null'::jsonb or d->>'walletId'<>'w_profits' or d->>'type' not in ('withdrawal','transfer_out') or d->>'sourceType' not in ('manual_withdrawal','transfer') then continue; end if;
  if d->>'sourceName' is distinct from 'profit_transfer' then raise exception 'erp_profit_cash_source_required'; end if;
  if p_actor->>'role'<>'admin' then raise exception using errcode='42501',message='erp_admin_required'; end if;
  if d->>'type' not in ('withdrawal','transfer_out') or d->>'currency'<>'EGP' or coalesce((d->>'amount')::numeric,0)<=0 then raise exception 'erp_invalid_profit_payment'; end if;
  if jsonb_typeof(d->'cashSourceAllocations') is distinct from 'object' then raise exception 'erp_profit_cash_source_required'; end if;
  if exists(select 1 from public.store_wallet_transactions where data->>'walletId'='w_profits' and data->>'referenceNumber'=d->>'referenceNumber' and coalesce(data->>'_erpTestScope','')=scope) then raise exception using errcode='PT409',message='erp_profit_reference_reused'; end if;
  select coalesce(sum(value::numeric),0) into total from jsonb_each_text(d->'cashSourceAllocations');
  if total<>(d->>'amount')::numeric then raise exception 'erp_profit_cash_total_mismatch'; end if;
  for source in select key id,value::numeric amount from jsonb_each_text(d->'cashSourceAllocations') loop
   select data into prior from public.store_wallets where id=source.id and coalesce(data->>'_erpTestScope','')=scope;
   if prior is null or prior->>'type'<>'operating' or prior->>'currency'<>'EGP' or coalesce((prior->>'isSystemWallet')::boolean,false) or source.id=d->>'targetWalletId' or source.amount<=0 or round(source.amount,2)<>source.amount then raise exception 'erp_invalid_profit_cash_source'; end if;
   select x->'after' into upcoming from jsonb_array_elements(p_changes) x where x->>'table'='store_wallets' and x->>'id'=source.id;
   if upcoming is null or upcoming='null'::jsonb or (prior->>'balance')::numeric-(upcoming->>'balance')::numeric<>source.amount or (upcoming->>'balance')::numeric<0 then raise exception 'erp_profit_cash_not_debited'; end if;
   if not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='store_wallet_transactions' and not coalesce((x->>'exists')::boolean,false) and x#>>'{after,walletId}'=source.id and x#>>'{after,type}'='withdrawal' and x#>>'{after,referenceNumber}'=(d->>'referenceNumber')||':'||source.id and (x#>>'{after,amount}')::numeric=source.amount) then raise exception 'erp_profit_cash_ledger_missing'; end if;
  end loop;
  if jsonb_typeof(d->'profitTicketAllocations') is distinct from 'object' then raise exception 'erp_profit_ticket_allocation_required'; end if;
  select coalesce(sum(value::numeric),0) into total from jsonb_each_text(d->'profitTicketAllocations');
  if total>(d->>'amount')::numeric or (d->>'shiftSettlementId' is not null and total<>(d->>'amount')::numeric) then raise exception 'erp_profit_ticket_total_mismatch'; end if;
  for t in select key id,value::numeric amount from jsonb_each_text(d->'profitTicketAllocations') loop
   select data into ticket from public.tickets where id=t.id and coalesce(data->>'_erpTestScope','')=scope;
   if ticket is null or ticket->>'status'<>'completed' or t.amount<=0 then raise exception 'erp_invalid_profit_ticket'; end if;
   earned:=round(coalesce((ticket->>'netProfit')::numeric,(ticket->>'totalProfitMargin')::numeric,0)*case when coalesce((ticket->>'receivedAmount')::numeric,0)>0 then greatest(0,1-coalesce((ticket#>>'{refundDetails,amount}')::numeric,0)/(ticket->>'receivedAmount')::numeric) else 1 end,2);
   select coalesce(sum((data->'profitTicketAllocations'->>t.id)::numeric),0) into moved from public.store_wallet_transactions where data->>'walletId'='w_profits' and data->>'type' in ('withdrawal','transfer_out') and coalesce(data->>'_erpTestScope','')=scope;
   if t.amount>greatest(0,earned-moved) then raise exception using errcode='PT409',message='erp_ticket_profit_already_paid'; end if;
  end loop;
 end loop;
 -- Old clients may still have the gross sweep screen open. Reject that route.
 for c in select value from jsonb_array_elements(p_changes) where value->>'table'='safe_transactions' and not coalesce((value->>'exists')::boolean,false) loop
  if c#>>'{after,category}'='shift_settlement' then raise exception using errcode='PT409',message='erp_refresh_required_net_profit_settlement'; end if;
 end loop;
 for c in select value from jsonb_array_elements(p_changes) where value->>'table'='shift_settlements' and not coalesce((value->>'exists')::boolean,false) loop
  d:=c->'after';
  if d='null'::jsonb then continue; end if;
  if p_actor->>'role'<>'admin' then raise exception using errcode='42501',message='erp_admin_required'; end if;
  if d->>'settlementMode' is distinct from 'net_profit_v1' or d->>'status'<>'closed' or coalesce(jsonb_array_length(d->'ticketIds'),0)=0 then raise exception 'erp_net_profit_settlement_required'; end if;
  total:=0;
  for t in select value #>> '{}' id from jsonb_array_elements(d->'ticketIds') loop
   select data into ticket from public.tickets where id=t.id and coalesce(data->>'_erpTestScope','')=scope;
   select x->'after' into upcoming from jsonb_array_elements(p_changes) x where x->>'table'='tickets' and x->>'id'=t.id;
   if ticket is null or ticket->>'status'<>'completed' or ticket->>'shiftSettlementId' is not null or upcoming->>'shiftSettlementId' is distinct from d->>'id' then raise exception using errcode='PT409',message='erp_shift_ticket_already_closed'; end if;
   total:=total+round(coalesce((ticket->>'netProfit')::numeric,(ticket->>'totalProfitMargin')::numeric,0)*case when coalesce((ticket->>'receivedAmount')::numeric,0)>0 then greatest(0,1-coalesce((ticket#>>'{refundDetails,amount}')::numeric,0)/(ticket->>'receivedAmount')::numeric) else 1 end,2);
  end loop;
  paid:=coalesce((d->>'totalTransferredEGP')::numeric,0);
  if paid<0 or paid>greatest(0,total) or paid<>coalesce((d#>>'{allocations,transferredProfit}')::numeric,-1) then raise exception 'erp_shift_profit_overpayment'; end if;
  if paid>0 and not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='store_wallet_transactions' and not coalesce((x->>'exists')::boolean,false) and x#>>'{after,walletId}'='w_profits' and x#>>'{after,shiftSettlementId}'=d->>'id' and (x#>>'{after,amount}')::numeric=paid) then raise exception 'erp_shift_profit_payment_missing'; end if;
 end loop;
end $$;
revoke all on function erp_private.validate_profit_funding(jsonb,jsonb) from public,anon,authenticated;
do $$ declare definition text; anchor text:='perform erp_private.validate_profit_loss_settlements(p_changes,a);'; begin
 definition:=pg_get_functiondef('erp_private.commit_changes(uuid,jsonb)'::regprocedure);
 if position('perform erp_private.validate_profit_funding(p_changes,a);' in definition)=0 then
  if position(anchor in definition)=0 then raise exception 'commit_validation_anchor_missing'; end if;
  execute replace(definition,anchor,anchor||E'\n perform erp_private.validate_profit_funding(p_changes,a);');
 end if;
end $$;
notify pgrst,'reload schema';
