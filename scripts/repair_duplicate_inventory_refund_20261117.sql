do $repair$
declare wallet_id text:='w_sub_1790058219031';duplicate_id text:='tx_restore_1794870680019';ref text:='FIX-REFUND-ONCE-20261117-FAZER';
 wallets jsonb;lots jsonb;txs jsonb;w jsonb;duplicate jsonb;consumption jsonb;difference numeric;fifo numeric;before_points numeric;after_points numeric;now_text text:=clock_timestamp()::text;new_txs jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('ammar_erp_financial_commit',0));
 perform 1 from public.system_kv where key in ('jkr_wallets_v2','nzm_jkr_jkr_wallets_v2','jkr_wallet_transactions_v2','nzm_jkr_jkr_wallet_transactions_v2','jkr_wallet_lots_v2','nzm_jkr_jkr_wallet_lots_v2') for update;
 select value into wallets from public.system_kv where key='jkr_wallets_v2';
 select value into lots from public.system_kv where key='jkr_wallet_lots_v2';
 select value into txs from public.system_kv where key='jkr_wallet_transactions_v2';
 if exists(select 1 from jsonb_array_elements(txs)t where t->>'id'=ref) then return;end if;
 select value into w from jsonb_array_elements(wallets) where value->>'id'=wallet_id;
 select value into duplicate from jsonb_array_elements(txs) where value->>'id'=duplicate_id;
 select value into consumption from jsonb_array_elements(txs) where value->>'walletId'=wallet_id and value->>'transactionType'='CONSUMPTION' and value->>'status'='CANCELLED' and coalesce(value->>'ticketNumber',value->>'ticketId',value->>'referenceId')=duplicate->>'referenceId';
 if w->>'name'<>'FAZER' or duplicate is null or consumption is null or duplicate->>'referenceId'<>'JKR-2026-5316' or (duplicate->>'quantityIn')::numeric<>25.06 or (consumption->>'quantityOut')::numeric<>25.06 then raise exception 'refund_repair_evidence_changed';end if;
 if exists(select 1 from jsonb_array_elements(txs)t where t->>'walletId'=wallet_id and t->>'transactionType'='REVERSAL' and coalesce(t->>'referenceId',t->>'ticketNumber',t->>'ticketId')=duplicate->>'referenceId') then raise exception 'refund_repair_original_reversal_already_recorded';end if;
 select sum((l->>'remainingQuantity')::numeric) into fifo from jsonb_array_elements(lots)l where l->>'walletId'=wallet_id and l->>'currencyOrPoints'='POINTS';
 before_points:=(w->>'pointsBalance')::numeric;difference:=before_points-fifo;
 if difference<>25.06 then raise exception 'refund_repair_balance_does_not_match_duplicate %',difference;end if;
 after_points:=before_points-difference;
 insert into erp_private.release_backup(table_name,rows,captured_at)
 select ref,jsonb_agg(jsonb_build_object('key',key,'value',value)),clock_timestamp() from public.system_kv where key in ('jkr_wallets_v2','nzm_jkr_jkr_wallets_v2','jkr_wallet_transactions_v2','nzm_jkr_jkr_wallet_transactions_v2','jkr_wallet_lots_v2','nzm_jkr_jkr_wallet_lots_v2')
 on conflict(table_name) do nothing;
 -- The first real FIFO return happened historically, but its journal row was
 -- overwritten by the bug. Backfill that missing row without crediting the wallet.
 new_txs:=jsonb_build_array(
 jsonb_build_object('id',ref,'transactionNumber',ref,'walletId',wallet_id,'walletName','FAZER','walletType','SUB','transactionType','ADJUSTMENT','status','ADJUSTED','quantityOut',difference,'amountEGP',0,'balanceAfter',after_points,'referenceType','TICKET','referenceId',duplicate->>'referenceId','ticketNumber',duplicate->>'referenceId','performedBy',jsonb_build_object('id','system_repair','name','إصلاح النظام','role','admin'),'notes','تصحيح زيادة رد نقاط التذكرة مرتين؛ لا يتغير النقد أو مخزون FIFO','snapshot',jsonb_build_object('duplicateTransactionId',duplicate_id,'pointsBefore',before_points,'pointsAfter',after_points,'repairType','duplicate_refund_correction'),'createdAt',now_text),
 jsonb_build_object('id',ref||'-MISSING-JOURNAL','transactionNumber',ref||'-HISTORICAL','walletId',wallet_id,'walletName','FAZER','walletType','SUB','transactionType','REVERSAL','status','REVERSED','quantityIn',difference,'amountEGP',(consumption->>'amountEGP')::numeric,'amountUSD',coalesce((consumption->>'amountUSD')::numeric,difference),'balanceAfter',(consumption->>'balanceAfter')::numeric+difference,'referenceType','TICKET','referenceId',duplicate->>'referenceId','ticketNumber',duplicate->>'referenceId','performedBy',jsonb_build_object('id','system_repair','name','إصلاح النظام','role','admin'),'notes','توثيق الرد الأصلي الذي أعاد FIFO سابقاً وحُذفت حركته بالخطأ؛ هذه إضافة تاريخية للسجل فقط','snapshot',jsonb_build_object('backfilledAt',now_text,'originalConsumptionTransactionId',consumption->>'id','reconciliationReference',ref),'createdAt',duplicate->>'createdAt'))||txs;
 select jsonb_agg(case when item->>'id'=wallet_id then item||jsonb_build_object('pointsBalance',after_points,'updatedAt',now_text) else item end order by ordinal) into wallets from jsonb_array_elements(wallets) with ordinality a(item,ordinal);
 update public.system_kv set value=wallets,updated_at=clock_timestamp() where key in ('jkr_wallets_v2','nzm_jkr_jkr_wallets_v2');
 update public.system_kv set value=new_txs,updated_at=clock_timestamp() where key in ('jkr_wallet_transactions_v2','nzm_jkr_jkr_wallet_transactions_v2');
 insert into public.audit_logs(id,data) values(ref,jsonb_build_object('id',ref,'userId','system_repair','userName','إصلاح النظام','userRole','admin','department','المالية','actionType','edit','entityType','jkr_wallet','entityId',wallet_id,'entityTitle','تصحيح رد نقاط FAZER المكرر','details',format('تصحيح %s نقطة مكررة: %s ← %s. النقد ودفعات FIFO لم تتغير.',difference,before_points,after_points),'previousState',jsonb_build_object('pointsBalance',before_points),'newState',jsonb_build_object('pointsBalance',after_points),'timestamp',now_text));
end $repair$;
