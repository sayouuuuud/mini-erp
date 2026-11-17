-- Run with the migration text first in the same rollback-only transaction.
do $$
declare scope text:='__qa_shift_'||replace(gen_random_uuid()::text,'-',''); uid uuid; sid uuid:=gen_random_uuid();
 profile jsonb; wallet jsonb; ticket jsonb; funding jsonb; payout jsonb; cash jsonb; payload jsonb; bad jsonb; result jsonb; op uuid:=gen_random_uuid(); denied boolean; checks int:=0; settlement jsonb;
begin
 profile:=jsonb_build_object('id',scope||'_user','username',scope,'fullName','Rollback shift test','role','admin','isActive',true,'password',gen_random_uuid()::text,'permissions',jsonb_build_array('view','add','edit','manage_finance'),'_erpTestScope',scope);
 insert into public.users(id,data) values(profile->>'id',profile-'password');uid:=erp_private.sync_identity(profile);
 update erp_private.members set test_scope=scope where auth_id=uid;
 insert into auth.sessions(id,user_id) values(sid,uid);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',sid)::text,true);
 wallet:=jsonb_build_object('id',scope||'_cash','name','Cash','type','operating','currency','EGP','balance',1000,'_erpTestScope',scope);
 ticket:=jsonb_build_object('id',scope||'_ticket','status','completed','netProfit',230,'receivedAmount',1000,'totalCostAmount',700,'paymentWalletId',wallet->>'id','_erpTestScope',scope);
 insert into public.store_wallets(id,data) values(wallet->>'id',wallet);
 insert into public.tickets(id,data) values(ticket->>'id',ticket);
 funding:=jsonb_build_object('id',scope||'_funding','walletId',wallet->>'id','type','withdrawal','amount',230,'referenceNumber',scope||'_ref:'||(wallet->>'id'),'currency','EGP','sourceType','transfer');
 payout:=jsonb_build_object('id',scope||'_payout','walletId','w_profits','type','withdrawal','amount',230,'currency','EGP','sourceType','manual_withdrawal','sourceName','profit_transfer','referenceNumber',scope||'_ref','targetWalletId','vault_main','cashSourceAllocations',jsonb_build_object(wallet->>'id',230),'profitTicketAllocations',jsonb_build_object(ticket->>'id',230));
 cash:=jsonb_build_object('id',scope||'_safe','type','cash_in','category','wallet_transfer','amount',230,'currency','EGP','referenceId',scope||'_ref');
 payload:=jsonb_build_array(
 jsonb_build_object('table','store_wallets','id',wallet->>'id','exists',true,'before',wallet,'after',jsonb_set(wallet,'{balance}','770')),
 jsonb_build_object('table','store_wallet_transactions','id',funding->>'id','exists',false,'before',null,'after',funding),
 jsonb_build_object('table','store_wallet_transactions','id',payout->>'id','exists',false,'before',null,'after',payout),
 jsonb_build_object('table','safe_transactions','id',cash->>'id','exists',false,'before',null,'after',cash));
 -- Reject payment without physical debit, wrong debit, missing cash ledger,
 -- invalid ticket amount, missing destination, and obsolete gross sweep.
 for bad in select value from jsonb_array_elements(jsonb_build_array(
   payload-0,
   jsonb_set(payload,'{0,after,balance}','780'),
   payload-1,
   jsonb_set(payload,array['2','after','profitTicketAllocations',ticket->>'id'],'231'),
   payload-3,
   jsonb_set(payload,'{3,after,category}','"shift_settlement"'))) loop
  denied:=false;
  begin perform erp_private.commit_changes(gen_random_uuid(),bad);exception when others then denied:=true;end;
  if not denied then raise exception 'unsafe_payout_accepted: %',checks;end if;
  if (select data->>'balance' from public.store_wallets where id=wallet->>'id')<>'1000' then raise exception 'partial_write';end if;
  checks:=checks+1;
 end loop;
 -- Role check.
 update public.users set data=jsonb_set(data,'{role}','"employee"') where id=profile->>'id';
 denied:=false;begin perform erp_private.commit_changes(gen_random_uuid(),payload);exception when sqlstate '42501' then denied:=true;end;
 if not denied then raise exception 'employee_payout_accepted';end if;checks:=checks+1;
 update public.users set data=jsonb_set(data,'{role}','"admin"') where id=profile->>'id';
 begin
 result:=erp_private.commit_changes(op,payload);
 if erp_private.profit_available('w_profits',scope)<>0 or (select (data->>'balance')::numeric from public.store_wallets where id=wallet->>'id')<>770 then raise exception 'funded_payout_failed';end if;
 if (select (data->>'amount')::numeric from public.safe_transactions where id=cash->>'id')<>230 then raise exception 'cash_destination_failed';end if;checks:=checks+1;
 if erp_private.commit_changes(op,payload)<>result then raise exception 'non_idempotent_retry';end if;checks:=checks+1;
 denied:=false;begin perform erp_private.commit_changes(gen_random_uuid(),payload);exception when sqlstate 'PT409' then denied:=true;end;
 if not denied then raise exception 'duplicate_accepted';end if;checks:=checks+1;
 -- Restore only this isolated test scope and test a complete atomic close.
 raise exception using errcode='ZX001',message='rollback_scoped_payment';
 exception when sqlstate 'ZX001' then null;end;
 settlement:=jsonb_build_object('id',scope||'_close','status','closed','settlementMode','net_profit_v1','ticketIds',jsonb_build_array(ticket->>'id'),'totalTransferredEGP',230,'allocations',jsonb_build_object('transferredProfit',230));
 payload:=jsonb_set(payload,'{2,after,shiftSettlementId}',to_jsonb(settlement->>'id'))||jsonb_build_array(
 jsonb_build_object('table','tickets','id',ticket->>'id','exists',true,'before',ticket,'after',ticket||jsonb_build_object('shiftSettlementId',settlement->>'id')),
 jsonb_build_object('table','shift_settlements','id',settlement->>'id','exists',false,'before',null,'after',settlement));
 perform erp_private.commit_changes(gen_random_uuid(),payload);
 if (select data->>'shiftSettlementId' from public.tickets where id=ticket->>'id') is distinct from settlement->>'id' then raise exception 'ticket_not_closed';end if;checks:=checks+1;
 if (select count(*) from public.shift_settlements where data->>'_erpTestScope'=scope)<>1 or erp_private.profit_available('w_profits',scope)<>0 then raise exception 'close_failed';end if;checks:=checks+1;
 if checks<>12 then raise exception 'check_counter: %',checks;end if;
end $$;
select 'PASS: 12 rollback-only shift checks; conservation 1000 = 770 source + 230 vault, no duplicate profit, full close atomic' as verification;
