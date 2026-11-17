-- User-requested correction of the inspected 7,330 EGP shift only.
-- Run first inside BEGIN/ROLLBACK; the guarded correction is idempotent.
set local lock_timeout='5s';
do $$
declare sid text:='settle_c9dfb224-74a3-458b-baa4-0491db04d042';s jsonb;w jsonb;n jsonb;updated_numbers jsonb:='[]';k text;wid text;txid text;ref text;stamp text:=clock_timestamp()::text;egypt_day text:=(clock_timestamp() at time zone 'Africa/Cairo')::date::text;
 profit numeric:=748.40;remaining numeric:=6581.60;goods numeric:=6405;amount numeric;line_balance numeric;before_assets numeric;after_assets numeric;before_tickets text;expected jsonb;transfers jsonb:='[]';cnt int;
begin
 perform pg_advisory_xact_lock(hashtextextended('ammar_erp_financial_commit',0));
 select data into s from public.shift_settlements where id=sid for update;
 if s->>'settlementMode'='distribution_v2' and s#>>'{distributionCorrection,reference}'='CORR-DIST-'||sid then return;end if;
 if s is null or s->>'settlementMode'<>'net_profit_v1' or s->>'status'<>'closed' or (s->>'totalRevenue')::numeric<>7330 or s#>'{allocations,previouslyTransferredProfit}'<>'0'::jsonb then raise exception 'inspected_shift_changed';end if;
 select data into w from public.store_wallets where id='w_1790122523296' for update;
 if w->>'type'<>'operating' or w->>'currency'<>'EGP' or (w->>'balance')::numeric<>remaining or coalesce(w->>'_erpTestScope','')<>'' then raise exception 'inspected_reception_changed';end if;
 if (select count(*) from public.safe_transactions where id in(select value#>>'{}' from jsonb_array_elements(s->'safeTransactionIds')) and data->>'type'='cash_in' and (data->>'amount')::numeric=profit)<>1 then raise exception 'original_profit_cash_leg_changed';end if;
 select count(*) into cnt from public.store_wallet_transactions where data->>'walletId'='w_profits' and data->>'shiftSettlementId'=sid and data->>'sourceName'='profit_transfer' and (data->>'amount')::numeric=profit and data->>'reclassifiedToTreasuryAt' is null;
 if cnt<>1 then raise exception 'original_profit_marker_changed';end if;
 if exists(select 1 from public.store_wallets where data->>'type'='treasury' and coalesce((data->>'balance')::numeric,0)<>0 and coalesce(data->>'_erpTestScope','')='') then raise exception 'treasury_state_changed_review_required';end if;
 select md5(coalesce(string_agg(data::text,',' order by id),'')) into before_tickets from public.tickets;
 select coalesce(sum(case data->>'type' when 'cash_in' then (data->>'amount')::numeric when 'cash_out' then -(data->>'amount')::numeric else 0 end),0) into before_assets from public.safe_transactions where coalesce(data->>'_erpTestScope','')='';
 before_assets:=before_assets+(select coalesce(sum((data->>'balance')::numeric),0) from public.store_wallets where data->>'type' in ('operating','treasury') and not coalesce((data->>'isSystemWallet')::boolean,false) and coalesce(data->>'_erpTestScope','')='');
 select count(*) into cnt from public.tickets where s->'ticketIds'?id and data->>'status'='completed' and data->>'shiftSettlementId'=sid;
 if cnt<>5 then raise exception 'closed_ticket_set_changed';end if;
 select jsonb_build_object('goods',round(sum((data->>'totalCostAmount')::numeric),2),'profits',round(sum((data->>'netProfit')::numeric),2),'cashback',round(sum((data->>'cashbackEarned')::numeric),2),'referrals',round(sum((data->>'referralCommissionEarned')::numeric),2),'trust',round(sum(coalesce((data->>'overpaymentAmount')::numeric,0)),2),'operating_expenses',round(sum((data->>'fixedCostAmount')::numeric),2)) into expected from public.tickets where s->'ticketIds'?id;
 if expected<>'{"goods":6405,"profits":748.4,"cashback":73.3,"referrals":73.3,"trust":0,"operating_expenses":30}'::jsonb then raise exception 'ticket_allocation_values_changed';end if;
 insert into erp_private.release_backup(table_name,rows)
 select 'separate_treasuries_nov11_'||name,rows from (
 select 'store_wallets' name,coalesce(jsonb_agg(to_jsonb(t)),'[]') rows from public.store_wallets t
 union all select 'store_wallet_transactions',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.store_wallet_transactions t
 union all select 'safe_transactions',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.safe_transactions t
 union all select 'shift_settlements',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.shift_settlements t) b on conflict(table_name) do nothing;
 ref:='CORR-DIST-'||sid;
 for n in select value from jsonb_array_elements(w->'numbers') loop
  line_balance:=coalesce((n->>'currentBalance')::numeric,0);
  n:=n||jsonb_build_object('currentBalance',0,'dailySent',case when w->>'lastDailyResetDate'=egypt_day then coalesce((n->>'dailySent')::numeric,0) else 0 end+line_balance,'dailyReceived',case when w->>'lastDailyResetDate'=egypt_day then coalesce((n->>'dailyReceived')::numeric,0) else 0 end,'monthlySent',coalesce((n->>'monthlySent')::numeric,0)+line_balance,'totalSent',coalesce((n->>'totalSent')::numeric,0)+line_balance,'monthlyWithdrawn',coalesce((n->>'monthlyWithdrawn')::numeric,0)+line_balance,'lastUsedAt',stamp);
  updated_numbers:=updated_numbers||jsonb_build_array(n);
 end loop;
 update public.store_wallets set data=data||jsonb_build_object('balance',0,'numbers',updated_numbers,'dailySent',case when w->>'lastDailyResetDate'=egypt_day then coalesce((w->>'dailySent')::numeric,0) else 0 end+remaining,'dailyIncome',case when w->>'lastDailyResetDate'=egypt_day then coalesce((w->>'dailyIncome')::numeric,0) else 0 end,'monthlySent',coalesce((w->>'monthlySent')::numeric,0)+remaining,'monthlyWithdrawn',coalesce((w->>'monthlyWithdrawn')::numeric,0)+remaining,'totalWithdrawn',coalesce((w->>'totalWithdrawn')::numeric,0)+remaining,'lastDailyResetDate',egypt_day,'updatedAt',stamp),updated_at=clock_timestamp() where id=w->>'id';
 txid:=ref||':out:'||(w->>'id');
 insert into public.store_wallet_transactions(id,data) values(txid,jsonb_build_object('id',txid,'walletId',w->>'id','walletName',w->>'name','type','withdrawal','sourceType','transfer','amount',remaining,'currency','EGP','balanceBefore',remaining,'balanceAfter',0,'referenceNumber',txid,'description','توزيع متبقي الوردية على البضاعة والخزن المنفصلة','createdAt',stamp));
 -- Move the original profit cash from main into its own treasury, preserving the original deposit.
 txid:=ref||':main-out';insert into public.safe_transactions(id,data) values(txid,jsonb_build_object('id',txid,'type','cash_out','amount',profit,'category','treasury_transfer','currency','EGP','referenceId',ref,'operationNumber',txid,'description','إعادة تصنيف ربح الوردية من الرئيسية إلى خزنة الأرباح المنفصلة','createdAt',stamp,'performedBy','تصحيح معتمد من المالك'));
 txid:=ref||':goods';insert into public.safe_transactions(id,data) values(txid,jsonb_build_object('id',txid,'type','cash_in','amount',goods,'category','shift_distribution','currency','EGP','referenceId',ref,'operationNumber',txid,'description','تكلفة البضاعة من تصحيح توزيع الوردية','createdAt',(clock_timestamp()+interval '1 millisecond')::text,'performedBy','تصحيح معتمد من المالك'));
 transfers:=jsonb_build_array(jsonb_build_object('id',txid,'sourceWalletId',w->>'id','sourceWalletName',w->>'name','destination','الخزنة الرئيسية — تكلفة البضاعة','destinationVaultId','vault_main','amount',goods,'currency','EGP','safeTransactionId',txid,'transferredAt',stamp));
 for k,amount in select * from (values('profits',748.40),('cashback',73.30),('referrals',73.30),('trust',0),('operating_expenses',30)) a(k,v) loop
  wid:='treasury_'||k;
  insert into public.store_wallets(id,data) values(wid,jsonb_build_object('id',wid,'name',case k when 'profits' then 'خزنة الأرباح' when 'cashback' then 'خزنة الكاش باك' when 'referrals' then 'خزنة الإحالات' when 'trust' then 'خزنة الأمانات' else 'خزنة مصاريف التشغيل' end,'type','treasury','treasuryKind',k,'balance',amount,'currency','EGP','controlledBy','owner','allowWithdrawal',true,'createdAt',stamp,'updatedAt',stamp)) on conflict(id) do update set data=excluded.data,updated_at=clock_timestamp();
  if amount>0 then
   txid:=ref||':in:'||wid;insert into public.store_wallet_transactions(id,data) values(txid,jsonb_build_object('id',txid,'walletId',wid,'walletName',case k when 'profits' then 'خزنة الأرباح' when 'cashback' then 'خزنة الكاش باك' when 'referrals' then 'خزنة الإحالات' else 'خزنة مصاريف التشغيل' end,'type','deposit','sourceType','transfer','sourceName','shift_distribution','amount',amount,'currency','EGP','balanceBefore',0,'balanceAfter',amount,'referenceNumber',txid,'description','مخصص الوردية في خزنته المنفصلة','createdAt',stamp));
   transfers:=transfers||jsonb_build_array(jsonb_build_object('id',txid,'sourceWalletId','shift_pool','sourceWalletName','تصحيح الوردية','destination',case k when 'profits' then 'خزنة الأرباح' when 'cashback' then 'خزنة الكاش باك' when 'referrals' then 'خزنة الإحالات' else 'خزنة مصاريف التشغيل' end,'destinationVaultId',wid,'amount',amount,'currency','EGP','walletTransactionId',txid,'transferredAt',stamp));
  end if;
 end loop;
 update public.store_wallet_transactions set data=data||jsonb_build_object('reclassifiedToTreasuryAt',stamp,'reclassificationReference',ref,'reclassificationReason','الربح أصبح في خزنته المنفصلة؛ لم يتم صرفه للرئيسية'),updated_at=clock_timestamp() where data->>'walletId'='w_profits' and data->>'shiftSettlementId'=sid and data->>'sourceName'='profit_transfer';
 update public.shift_settlements set data=data||jsonb_build_object('settlementMode','distribution_v2','distribution',expected,'distributionReference',ref,'distributionSources',jsonb_build_object(w->>'id',remaining,'main_vault',profit),'totalTransferredEGP',7330,'transfers',transfers,'destination','تكلفة البضاعة للرئيسية وباقي المخصصات لخزنها المنفصلة','distributionCorrection',jsonb_build_object('reference',ref,'correctedAt',stamp,'originalMode','net_profit_v1','originalSafeTransactionIds',s->'safeTransactionIds')),updated_at=clock_timestamp() where id=sid;
 select coalesce(sum(case data->>'type' when 'cash_in' then (data->>'amount')::numeric when 'cash_out' then -(data->>'amount')::numeric else 0 end),0) into after_assets from public.safe_transactions where coalesce(data->>'_erpTestScope','')='';
 after_assets:=after_assets+(select coalesce(sum((data->>'balance')::numeric),0) from public.store_wallets where data->>'type' in ('operating','treasury') and not coalesce((data->>'isSystemWallet')::boolean,false) and coalesce(data->>'_erpTestScope','')='');
 if before_assets<>after_assets or before_tickets<>(select md5(coalesce(string_agg(data::text,',' order by id),'')) from public.tickets) then raise exception 'correction_cash_or_tickets_changed';end if;
end $$;
select (select sum((data->>'balance')::numeric) from public.store_wallets where data->>'type'='operating') reception,
 (select sum(case data->>'type' when 'cash_in' then (data->>'amount')::numeric when 'cash_out' then -(data->>'amount')::numeric else 0 end) from public.safe_transactions) main_cash,
 (select jsonb_object_agg(data->>'treasuryKind',data->'balance') from public.store_wallets where data->>'type'='treasury') treasuries,
 erp_private.profit_available('w_profits','') available_profit;

-- Complete the running-balance metadata on the two new correction cash legs.
update public.safe_transactions set data=data||jsonb_build_object('balanceBefore',748.4,'balanceAfter',0,'vaultId','main_vault'),updated_at=clock_timestamp() where id='CORR-DIST-settle_c9dfb224-74a3-458b-baa4-0491db04d042:main-out' and data->>'type'='cash_out' and (data->>'amount')::numeric=748.4;
update public.safe_transactions set data=data||jsonb_build_object('balanceBefore',0,'balanceAfter',6405,'vaultId','main_vault'),updated_at=clock_timestamp() where id='CORR-DIST-settle_c9dfb224-74a3-458b-baa4-0491db04d042:goods' and data->>'type'='cash_in' and (data->>'amount')::numeric=6405;
