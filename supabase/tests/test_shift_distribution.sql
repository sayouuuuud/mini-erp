-- Actual RPC boundary tests. Always execute inside BEGIN / ROLLBACK.
do $$
declare scope text:='__qa_dist_'||replace(gen_random_uuid()::text,'-','');uid uuid;sid uuid:=gen_random_uuid();profile jsonb;wallet jsonb;ticket jsonb;receipt jsonb;ledger jsonb;payout jsonb;safe jsonb;treasury jsonb;before_treasury jsonb;payload jsonb;bad jsonb;result jsonb;op uuid:=gen_random_uuid();denied boolean;checks int:=0;k text;amount numeric;ref text;
begin
 profile:=jsonb_build_object('id',scope||'_user','username',scope,'fullName','Distribution rollback QA','role','admin','isActive',true,'password',gen_random_uuid()::text,'permissions',jsonb_build_array('view','add','edit','manage_finance'),'_erpTestScope',scope);
 insert into public.users(id,data) values(profile->>'id',profile-'password');uid:=erp_private.sync_identity(profile);update erp_private.members set test_scope=scope where auth_id=uid;insert into auth.sessions(id,user_id) values(sid,uid);perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',sid)::text,true);
 wallet:=jsonb_build_object('id',scope||'_cash','name','Reception','type','operating','currency','EGP','balance',1000,'numbers',jsonb_build_array(jsonb_build_object('id','line','currentBalance',1000,'monthlyReceived',1000,'monthlySent',0)),'_erpTestScope',scope);
 ticket:=jsonb_build_object('id',scope||'_ticket','status','completed','receivedAmount',1000,'totalCostAmount',700,'netProfit',230,'cashbackEarned',10,'referralCommissionEarned',10,'fixedCostAmount',50,'_erpTestScope',scope);
 insert into public.store_wallets(id,data) values(wallet->>'id',wallet);insert into public.tickets(id,data) values(ticket->>'id',ticket);
 ref:='DIST-'||scope||'_close';
 receipt:=jsonb_build_object('id',scope||'_close','status','closed','settlementMode','distribution_v2','ticketIds',jsonb_build_array(ticket->>'id'),'totalTransferredEGP',1000,'distributionReference',ref,'distributionSources',jsonb_build_object(wallet->>'id',1000),'distribution',jsonb_build_object('goods',700,'profits',230,'cashback',10,'referrals',10,'trust',0,'operating_expenses',50));
 ledger:=jsonb_build_object('id',scope||'_out','walletId',wallet->>'id','type','withdrawal','sourceType','transfer','amount',1000,'currency','EGP','referenceNumber',ref||':out:'||(wallet->>'id'));
 safe:=jsonb_build_object('id',scope||'_safe','type','cash_in','category','shift_distribution','amount',700,'currency','EGP','referenceId',ref);
 payload:=jsonb_build_array(
 jsonb_build_object('table','store_wallets','id',wallet->>'id','exists',true,'before',wallet,'after',jsonb_set(jsonb_set(jsonb_set(wallet,'{balance}','0'),'{numbers,0,currentBalance}','0'),'{numbers,0,monthlySent}','1000')),
 jsonb_build_object('table','store_wallet_transactions','id',ledger->>'id','exists',false,'before',null,'after',ledger),
 jsonb_build_object('table','safe_transactions','id',safe->>'id','exists',false,'before',null,'after',safe),
 jsonb_build_object('table','tickets','id',ticket->>'id','exists',true,'before',ticket,'after',ticket||jsonb_build_object('shiftSettlementId',receipt->>'id')),
 jsonb_build_object('table','shift_settlements','id',receipt->>'id','exists',false,'before',null,'after',receipt));
 for k,amount in select * from (values('profits',230),('cashback',10),('referrals',10),('trust',0),('operating_expenses',50)) v(k,a) loop
  treasury:=jsonb_build_object('id',scope||'_'||k,'name',k,'type','treasury','treasuryKind',k,'balance',amount,'currency','EGP');
  payload:=payload||jsonb_build_array(jsonb_build_object('table','store_wallets','id',treasury->>'id','exists',false,'before',null,'after',treasury));
  if amount>0 then
   ledger:=jsonb_build_object('id',scope||'_in_'||k,'walletId',treasury->>'id','type','deposit','sourceType','transfer','amount',amount,'currency','EGP','referenceNumber',ref||':in:'||(treasury->>'id'));
   payload:=payload||jsonb_build_array(jsonb_build_object('table','store_wallet_transactions','id',ledger->>'id','exists',false,'before',null,'after',ledger));
  end if;
 end loop;
 -- Mutation cases retain conservation in some cases to prove destination semantics.
 for bad in select value from jsonb_array_elements(jsonb_build_array(
   payload-1,
   jsonb_set(payload,'{0,after,numbers,0,currentBalance}','1000'),
   jsonb_set(payload,'{0,after,balance}','770'),
   jsonb_set(payload,'{2,after,amount}','930'),
   jsonb_set(payload,'{4,after,distribution,profits}','231'),
   jsonb_set(payload,'{4,after,settlementMode}','"net_profit_v1"'),
   jsonb_set(payload,'{4,after,totalTransferredEGP}','1001')
 )) loop
  denied:=false;begin perform erp_private.commit_changes(gen_random_uuid(),bad);exception when others then denied:=true;end;
  if not denied then raise exception 'invalid_distribution_accepted %',checks;end if;
  if (select data->>'balance' from public.store_wallets where id=wallet->>'id')<>'1000' then raise exception 'partial_write';end if;checks:=checks+1;
 end loop;
 update public.users set data=jsonb_set(data,'{role}','"employee"') where id=profile->>'id';denied:=false;begin perform erp_private.commit_changes(gen_random_uuid(),payload);exception when sqlstate '42501' then denied:=true;end;if not denied then raise exception 'employee_accepted';end if;checks:=checks+1;
 update public.users set data=jsonb_set(data,'{role}','"admin"') where id=profile->>'id';
 result:=erp_private.commit_changes(op,payload);
 if (select (data->>'balance')::numeric from public.store_wallets where id=wallet->>'id')<>0 or (select (data->>'amount')::numeric from public.safe_transactions where id=safe->>'id')<>700 or (select (data->>'balance')::numeric from public.store_wallets where id=scope||'_profits')<>230 or erp_private.profit_available('w_profits',scope)<>230 then raise exception 'full_distribution_failed';end if;checks:=checks+1;
 if erp_private.commit_changes(op,payload)<>result then raise exception 'retry_not_idempotent';end if;checks:=checks+1;
 denied:=false;begin perform erp_private.commit_changes(gen_random_uuid(),payload);exception when sqlstate 'PT409' then denied:=true;end;if not denied then raise exception 'duplicate_close_accepted';end if;checks:=checks+1;
 -- Partial profit release: 100 leaves the profit treasury and enters main once.
 select data into before_treasury from public.store_wallets where id=scope||'_profits';ref:=scope||'_release';
 ledger:=jsonb_build_object('id',scope||'_release_cash','walletId',scope||'_profits','type','withdrawal','sourceType','transfer','amount',100,'currency','EGP','referenceNumber',ref||':'||scope||'_profits');
 payout:=jsonb_build_object('id',scope||'_release_profit','walletId','w_profits','type','withdrawal','sourceType','manual_withdrawal','sourceName','profit_transfer','amount',100,'currency','EGP','referenceNumber',ref,'targetWalletId','vault_main','cashSourceAllocations',jsonb_build_object(scope||'_profits',100),'profitTicketAllocations',jsonb_build_object(ticket->>'id',100));
 safe:=jsonb_build_object('id',scope||'_release_safe','type','cash_in','category','treasury_transfer','amount',100,'currency','EGP','referenceId',ref);
 payload:=jsonb_build_array(jsonb_build_object('table','store_wallets','id',scope||'_profits','exists',true,'before',before_treasury,'after',jsonb_set(before_treasury,'{balance}','130')),jsonb_build_object('table','store_wallet_transactions','id',ledger->>'id','exists',false,'before',null,'after',ledger),jsonb_build_object('table','store_wallet_transactions','id',payout->>'id','exists',false,'before',null,'after',payout),jsonb_build_object('table','safe_transactions','id',safe->>'id','exists',false,'before',null,'after',safe));
 denied:=false;begin perform erp_private.commit_changes(gen_random_uuid(),payload-0);exception when others then denied:=true;end;if not denied then raise exception 'unfunded_release_accepted';end if;checks:=checks+1;
 denied:=false;begin perform erp_private.commit_changes(gen_random_uuid(),jsonb_set(payload,'{0,after,balance}','-1'));exception when others then denied:=true;end;if not denied then raise exception 'negative_treasury_accepted';end if;checks:=checks+1;
 perform erp_private.commit_changes(gen_random_uuid(),payload);
 if erp_private.profit_available('w_profits',scope)<>130 or (select (data->>'balance')::numeric from public.store_wallets where id=scope||'_profits')<>130 then raise exception 'partial_release_failed';end if;checks:=checks+1;
 if (select sum((data->>'amount')::numeric) from public.safe_transactions where data->>'_erpTestScope'=scope)+(select sum((data->>'balance')::numeric) from public.store_wallets where data->>'_erpTestScope'=scope)<>1000 then raise exception 'cash_not_conserved';end if;checks:=checks+1;
 if checks<>15 then raise exception 'wrong_check_count %',checks;end if;
end $$;
select 'PASS: 15 server checks: full allocation, exact destinations, zero lines, cash conservation, atomic rollback, role, stale/duplicate requests, partial treasury release' verification;
