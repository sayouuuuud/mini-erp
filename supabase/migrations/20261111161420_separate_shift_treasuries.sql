-- Separate cash assets for shift allocations. Reuses protected JSON entities and
-- the existing serializable commit boundary; no new public tables or grants.
create or replace function erp_private.validate_shift_distribution(p_changes jsonb,p_actor jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare c jsonb; d jsonb; ticket jsonb; updated jsonb; prior jsonb; expected jsonb; sources jsonb;
 s record; k text; wid text; ref text; scope text:=coalesce(p_actor->>'_testScope','');
 goods numeric; profit numeric; cb numeric; rf numeric; trust_amount numeric; expenses numeric; used_cb numeric; used_rf numeric; used_trust numeric; ratio numeric; previous_paid numeric;
 received numeric; outgoing numeric; incoming numeric; before_balance numeric; after_balance numeric; cash_delta numeric:=0; total_sources numeric; total_dest numeric; recognized boolean;
begin
 recognized:=exists(select 1 from jsonb_array_elements(p_changes) x where (x->>'table'='shift_settlements' and x#>>'{after,settlementMode}'='distribution_v2') or (x->>'table'='safe_transactions' and x#>>'{after,category}'='treasury_transfer' and not coalesce((x->>'exists')::boolean,false)));
 for c in select value from jsonb_array_elements(p_changes) loop
  if c->>'table'='store_wallets' and (c#>>'{after,type}'='treasury' or c#>>'{before,type}'='treasury') then
   if p_actor->>'role'<>'admin' then raise exception using errcode='42501',message='erp_admin_required';end if;
   if not recognized then raise exception 'erp_treasury_funded_operation_required';end if;
   d:=c->'after';
   if d='null'::jsonb or d->>'type' is distinct from 'treasury' or d->>'currency' is distinct from 'EGP' or coalesce((d->>'isSystemWallet')::boolean,false) or coalesce(d->>'treasuryKind','') not in ('profits','cashback','referrals','trust','operating_expenses') or coalesce((d->>'balance')::numeric,-1)<0 then raise exception 'erp_invalid_treasury';end if;
   if c#>>'{before,type}'='treasury' and c#>>'{before,treasuryKind}' is distinct from d->>'treasuryKind' then raise exception 'erp_treasury_kind_immutable';end if;
  end if;
  if c->>'table'='shift_settlements' and not coalesce((c->>'exists')::boolean,false) and c->'after'<>'null'::jsonb and c#>>'{after,settlementMode}' is distinct from 'distribution_v2' then raise exception using errcode='PT409',message='erp_refresh_required_separate_treasuries';end if;
 end loop;
 if not recognized then return;end if;
 if p_actor->>'role'<>'admin' then raise exception using errcode='42501',message='erp_admin_required';end if;
 -- Cash conservation is checked independently of all reported totals and ledger labels.
 for c in select value from jsonb_array_elements(p_changes) loop
  if c->>'table'='store_wallets' and (c#>>'{after,type}' in ('operating','treasury') or c#>>'{before,type}' in ('operating','treasury')) and not coalesce((c#>>'{after,isSystemWallet}')::boolean,(c#>>'{before,isSystemWallet}')::boolean,false) then
   if coalesce(c#>>'{after,currency}',c#>>'{before,currency}')<>'EGP' then raise exception 'erp_distribution_currency_mismatch';end if;
   cash_delta:=cash_delta+coalesce((c#>>'{after,balance}')::numeric,0)-coalesce((c#>>'{before,balance}')::numeric,0);
  elsif c->>'table'='safe_transactions' then
   if coalesce(c#>>'{after,currency}',c#>>'{before,currency}','EGP')<>'EGP' then raise exception 'erp_distribution_currency_mismatch';end if;
   cash_delta:=cash_delta+case c#>>'{after,type}' when 'cash_in' then coalesce((c#>>'{after,amount}')::numeric,0) when 'cash_out' then -abs(coalesce((c#>>'{after,amount}')::numeric,0)) else 0 end-case c#>>'{before,type}' when 'cash_in' then coalesce((c#>>'{before,amount}')::numeric,0) when 'cash_out' then -abs(coalesce((c#>>'{before,amount}')::numeric,0)) else 0 end;
  end if;
 end loop;
 if round(cash_delta,2)<>0 then raise exception 'erp_distribution_cash_not_conserved';end if;
 for c in select value from jsonb_array_elements(p_changes) where value->>'table'='shift_settlements' and not coalesce((value->>'exists')::boolean,false) loop
  d:=c->'after';if d='null'::jsonb then continue;end if;
  if d->>'status'<>'closed' or jsonb_typeof(d->'ticketIds') is distinct from 'array' or jsonb_array_length(d->'ticketIds')=0 then raise exception 'erp_invalid_distribution_close';end if;
  if (select count(*)<>count(distinct value) from jsonb_array_elements(d->'ticketIds')) then raise exception 'erp_duplicate_shift_ticket';end if;
  goods:=0;profit:=0;cb:=0;rf:=0;trust_amount:=0;expenses:=0;used_cb:=0;used_rf:=0;used_trust:=0;
  for s in select value#>>'{}' id from jsonb_array_elements(d->'ticketIds') loop
   select data into ticket from public.tickets where id=s.id and coalesce(data->>'_erpTestScope','')=scope;
   select x->'after' into updated from jsonb_array_elements(p_changes) x where x->>'table'='tickets' and x->>'id'=s.id;
   if ticket is null or ticket->>'status'<>'completed' or ticket->>'shiftSettlementId' is not null or updated->>'shiftSettlementId' is distinct from d->>'id' then raise exception using errcode='PT409',message='erp_shift_ticket_already_closed';end if;
   ratio:=case when coalesce((ticket->>'receivedAmount')::numeric,(ticket->>'requiredAmount')::numeric,0)>0 then greatest(0,least(1,1-coalesce((ticket#>>'{refundDetails,amount}')::numeric,0)/coalesce((ticket->>'receivedAmount')::numeric,(ticket->>'requiredAmount')::numeric))) else 1 end;
   select coalesce(sum((data->'profitTicketAllocations'->>s.id)::numeric),0) into previous_paid from public.store_wallet_transactions where data->>'walletId'='w_profits' and data->>'type' in ('withdrawal','transfer_out') and nullif(data->>'reclassifiedToTreasuryAt','') is null and coalesce(data->>'_erpTestScope','')=scope;
   goods:=goods+round(coalesce((ticket->>'totalCostAmount')::numeric,0)*ratio,2);
   profit:=profit+round(coalesce((ticket->>'netProfit')::numeric,(ticket->>'totalProfitMargin')::numeric,0)*ratio,2)-previous_paid;
   cb:=cb+round(coalesce((ticket->>'cashbackEarned')::numeric,(ticket#>>'{pricingSnapshot,cashbackAmountEGP}')::numeric,0)*ratio,2);
   rf:=rf+round(coalesce((ticket->>'referralCommissionEarned')::numeric,(ticket#>>'{pricingSnapshot,referralAmountEGP}')::numeric,0)*ratio,2);
   expenses:=expenses+round(coalesce((ticket->>'fixedCostAmount')::numeric,(ticket#>>'{pricingSnapshot,fixedCostEGP}')::numeric,0)*ratio,2);
   trust_amount:=trust_amount+round(coalesce((ticket->>'overpaymentAmount')::numeric,0)*ratio,2);
   used_cb:=used_cb+round(coalesce((ticket->>'cashbackUsed')::numeric,0)*ratio,2);used_rf:=used_rf+round(coalesce((ticket->>'referralBalanceUsed')::numeric,0)*ratio,2);used_trust:=used_trust+round(coalesce((ticket->>'accountBalanceUsed')::numeric,0)*ratio,2);
  end loop;
  expected:=jsonb_build_object('goods',goods,'profits',greatest(profit,0),'cashback',cb,'referrals',rf,'trust',trust_amount,'operating_expenses',expenses);
  if d->'distribution' is distinct from expected then raise exception 'erp_distribution_amounts_mismatch';end if;
  sources:='{}'::jsonb;ref:='DIST-'||(d->>'id');
  if d->>'distributionReference' is distinct from ref then raise exception 'erp_distribution_reference_mismatch';end if;
  for s in select id,data from public.store_wallets where data->>'type'='operating' and not coalesce((data->>'isSystemWallet')::boolean,false) and coalesce(data->>'_erpTestScope','')=scope and coalesce((data->>'balance')::numeric,0)>0 loop
   if s.data->>'currency'<>'EGP' then raise exception 'erp_distribution_currency_mismatch';end if;
   outgoing:=(s.data->>'balance')::numeric;sources:=sources||jsonb_build_object(s.id,outgoing);
   select x->'after' into updated from jsonb_array_elements(p_changes) x where x->>'table'='store_wallets' and x->>'id'=s.id;
   if updated is null or coalesce((updated->>'balance')::numeric,-1)<>0 or exists(select 1 from jsonb_array_elements(coalesce(updated->'numbers','[]')) n where coalesce((n->>'currentBalance')::numeric,0)<>0) then raise exception 'erp_reception_not_zero';end if;
  end loop;
  for k in select unnest(array['profits','cashback','referrals','trust','operating_expenses']) loop
   outgoing:=case k when 'profits' then greatest(-profit,0) when 'cashback' then used_cb when 'referrals' then used_rf when 'trust' then used_trust else 0 end;
   incoming:=(expected->>k)::numeric;
   select x->'after' into updated from jsonb_array_elements(p_changes) x where x->>'table'='store_wallets' and x#>>'{after,type}'='treasury' and x#>>'{after,treasuryKind}'=k;
   if updated is null then
    select data into updated from public.store_wallets where data->>'type'='treasury' and data->>'treasuryKind'=k and coalesce(data->>'_erpTestScope','')=scope;
   end if;
   if updated is null then raise exception 'erp_treasury_missing';end if;
   wid:=updated->>'id';select data into prior from public.store_wallets where id=wid and coalesce(data->>'_erpTestScope','')=scope;
   before_balance:=coalesce((prior->>'balance')::numeric,0);
   if before_balance<outgoing or (updated->>'balance')::numeric<>before_balance-outgoing+incoming then raise exception 'erp_treasury_allocation_balance_mismatch';end if;
   if outgoing>0 then sources:=sources||jsonb_build_object(wid,outgoing);end if;
   if incoming>0 and not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='store_wallet_transactions' and not coalesce((x->>'exists')::boolean,false) and x#>>'{after,walletId}'=wid and x#>>'{after,type}'='deposit' and (x#>>'{after,amount}')::numeric=incoming and x#>>'{after,referenceNumber}'=ref||':in:'||wid) then raise exception 'erp_distribution_deposit_ledger_missing';end if;
  end loop;
  if d->'distributionSources' is distinct from sources then raise exception 'erp_distribution_sources_mismatch';end if;
  select coalesce(sum(value::numeric),0) into total_sources from jsonb_each_text(sources);
  select coalesce(sum(value::numeric),0) into total_dest from jsonb_each_text(expected);
  if total_sources<>total_dest or (d->>'totalTransferredEGP')::numeric<>total_dest then raise exception 'erp_distribution_totals_mismatch';end if;
  for s in select key id,value::numeric amount from jsonb_each_text(sources) loop
   if not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='store_wallet_transactions' and not coalesce((x->>'exists')::boolean,false) and x#>>'{after,walletId}'=s.id and x#>>'{after,type}'='withdrawal' and (x#>>'{after,amount}')::numeric=s.amount and x#>>'{after,referenceNumber}'=ref||':out:'||s.id) then raise exception 'erp_distribution_withdrawal_ledger_missing';end if;
  end loop;
  if goods>0 and not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='safe_transactions' and not coalesce((x->>'exists')::boolean,false) and x#>>'{after,referenceId}'=ref and x#>>'{after,type}'='cash_in' and x#>>'{after,category}'='shift_distribution' and x#>>'{after,currency}'='EGP' and (x#>>'{after,amount}')::numeric=goods) then raise exception 'erp_goods_vault_leg_missing';end if;
 end loop;
 -- Manual movement between a funded treasury and main vault, including partial amounts.
 for c in select value from jsonb_array_elements(p_changes) where value->>'table'='safe_transactions' and value#>>'{after,category}'='treasury_transfer' and not coalesce((value->>'exists')::boolean,false) loop
  d:=c->'after';ref:=d->>'referenceId';incoming:=(d->>'amount')::numeric;
  if d->>'type'<>'cash_in' or incoming<=0 then raise exception 'erp_invalid_treasury_transfer';end if;
  select x->'after' into updated from jsonb_array_elements(p_changes) x where x->>'table'='store_wallet_transactions' and x#>>'{after,type}'='withdrawal' and x#>>'{after,referenceNumber}'=ref||':'||(x#>>'{after,walletId}') and (x#>>'{after,amount}')::numeric=incoming;
  select data into prior from public.store_wallets where id=updated->>'walletId' and data->>'type'='treasury' and coalesce(data->>'_erpTestScope','')=scope;
  if prior is null then raise exception 'erp_treasury_transfer_source_missing';end if;
  wid:=prior->>'id';select x->'after' into updated from jsonb_array_elements(p_changes) x where x->>'table'='store_wallets' and x->>'id'=wid;
  if updated is null or (prior->>'balance')::numeric-(updated->>'balance')::numeric<>incoming or (updated->>'balance')::numeric<0 then raise exception 'erp_treasury_transfer_not_debited';end if;
  if prior->>'treasuryKind'='profits' and not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='store_wallet_transactions' and x#>>'{after,walletId}'='w_profits' and x#>>'{after,referenceNumber}'=ref and (x#>>'{after,amount}')::numeric=incoming and x#>>'{after,type}'='withdrawal') then raise exception 'erp_profit_treasury_release_missing';end if;
 end loop;
end $$;
revoke all on function erp_private.validate_shift_distribution(jsonb,jsonb) from public,anon,authenticated;
do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('erp_private.validate_profit_funding(jsonb,jsonb)'::regprocedure);
 definition:=replace(definition,$lit$prior->>'type'<>'operating'$lit$,$lit$not(prior->>'type'='operating' or (prior->>'type'='treasury' and prior->>'treasuryKind'='profits'))$lit$);
 definition:=replace(definition,$lit$and data->>'type' in ('withdrawal','transfer_out') and coalesce$lit$, $lit$and data->>'type' in ('withdrawal','transfer_out') and nullif(data->>'reclassifiedToTreasuryAt','') is null and coalesce$lit$);
 definition:=replace(definition,$lit$d:=c->'after';$lit$||E'\n  if d=''null''::jsonb then continue; end if;',$lit$d:=c->'after';$lit$||E'\n  if d=''null''::jsonb or d->>''settlementMode''=''distribution_v2'' then continue; end if;');
 execute definition;
 definition:=pg_get_functiondef('erp_private.profit_available(text,text)'::regprocedure);
 definition:=replace(definition,$lit$where x->>'walletId'=p_wallet$lit$, $lit$where nullif(x->>'reclassifiedToTreasuryAt','') is null and x->>'walletId'=p_wallet$lit$);execute definition;
 definition:=pg_get_functiondef('erp_private.commit_changes(uuid,jsonb)'::regprocedure);anchor:='perform erp_private.validate_profit_funding(p_changes,a);';
 if position('perform erp_private.validate_shift_distribution(p_changes,a);' in definition)=0 then
  if position(anchor in definition)=0 then raise exception 'commit_anchor_missing';end if;
  execute replace(definition,anchor,'perform erp_private.validate_shift_distribution(p_changes,a);'||E'\n '||anchor);
 end if;
end $$;
notify pgrst,'reload schema';
