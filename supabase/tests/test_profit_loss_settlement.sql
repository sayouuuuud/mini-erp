-- Isolated, rollback-only integration tests. No real accounts or financial rows change.
begin;
do $$
declare scope text:='__qa_loss_'||replace(gen_random_uuid()::text,'-',''); profile jsonb; uid uuid; sid uuid:=gen_random_uuid();
 ticket_id text; ticket jsonb; tx jsonb; payload jsonb; op uuid:=gen_random_uuid(); first_result jsonb; r jsonb;
 before_cash text; after_cash text; rejected boolean; counter integer:=0; v numeric;
begin
 profile:=jsonb_build_object('id',scope||'_user','username',scope,'fullName','Rollback-only loss test','role','admin','isActive',true,
  'password',gen_random_uuid()::text,'permissions',jsonb_build_array('view','add','edit','manage_finance'),'_erpTestScope',scope);
 insert into public.users(id,data) values(profile->>'id',profile-'password');
 uid:=erp_private.sync_identity(profile);
 update erp_private.members set test_scope=scope where auth_id=uid;
 insert into auth.sessions(id,user_id) values(sid,uid);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',sid)::text,true);
 if erp_private.actor()->>'id' is distinct from profile->>'id' then raise exception 'test_actor_failed'; end if;
 ticket_id:=scope||'_ticket'; ticket:=jsonb_build_object('id',ticket_id,'status','completed','netProfit',50.69,'receivedAmount',100,'_erpTestScope',scope);
 insert into public.tickets(id,data) values(ticket_id,ticket);
 insert into public.store_wallet_transactions(id,data) values(scope||'_prior',jsonb_build_object('id',scope||'_prior','walletId','w_profits','type','withdrawal','sourceType','manual_withdrawal','amount',50.69,'_erpTestScope',scope));
 insert into public.safe_transactions(id,data) values(scope||'_cash',jsonb_build_object('id',scope||'_cash','type','cash_in','amount',50.69,'_erpTestScope',scope));
 perform erp_private.commit_changes(gen_random_uuid(),jsonb_build_array(jsonb_build_object('table','tickets','id',ticket_id,'exists',true,'before',ticket,'after',null)));
 if erp_private.profit_available('w_profits',scope)<>-50.69 then raise exception 'test_deletion_deficit_failed'; end if;
 select md5(coalesce(string_agg(data::text,',' order by id),'')) into before_cash from public.safe_transactions where data->>'_erpTestScope'=scope;
 tx:=jsonb_build_object('id',scope||'_settle','walletId','w_profits','type','adjustment','sourceType','loss_settlement','sourceName','profit_loss_settlement',
  'amount',50.69,'currency','EGP','balanceBefore',-50.69,'balanceAfter',0,'referenceNumber',scope||'_ref','performedBy',jsonb_build_object('id',profile->>'id'));
 payload:=jsonb_build_array(jsonb_build_object('table','store_wallet_transactions','id',tx->>'id','exists',false,'before',null,'after',tx));
 -- Incorrect or partial/overlarge amounts fail before writing anything.
 foreach v in array array[0::numeric,50,51,-50.69] loop
  rejected:=false;
  begin perform erp_private.commit_changes(gen_random_uuid(),jsonb_set(payload,'{0,after,amount}',to_jsonb(v)));
  exception when sqlstate 'PT409' then rejected:=true; end;
  if not rejected then raise exception 'test_wrong_amount_accepted'; end if; counter:=counter+1;
 end loop;
 -- Cannot bundle settlement with cash mutations, even with a valid amount.
 rejected:=false;
 begin perform erp_private.commit_changes(gen_random_uuid(),payload||jsonb_build_array(jsonb_build_object('table','safe_transactions','id',scope||'_extra','exists',false,'before',null,'after',jsonb_build_object('id',scope||'_extra','amount',50.69))));
 exception when others then if sqlerrm<>'erp_loss_settlement_non_cash_only' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'test_cash_coupling_accepted'; end if; counter:=counter+1;
 update public.users set data=jsonb_set(data,'{role}','"employee"') where id=profile->>'id';
 rejected:=false;
 begin perform erp_private.commit_changes(gen_random_uuid(),payload);
 exception when sqlstate '42501' then rejected:=true; end;
 if not rejected then raise exception 'test_employee_accepted'; end if; counter:=counter+1;
 update public.users set data=jsonb_set(data,'{role}','"admin"') where id=profile->>'id';
 first_result:=erp_private.commit_changes(op,payload);
 if erp_private.profit_available('w_profits',scope)<>0 then raise exception 'test_settlement_not_zero'; end if; counter:=counter+1;
 if erp_private.commit_changes(op,payload)<>first_result then raise exception 'test_retry_not_idempotent'; end if; counter:=counter+1;
 rejected:=false;
 begin perform erp_private.commit_changes(gen_random_uuid(),jsonb_set(jsonb_set(payload,'{0,id}',to_jsonb(scope||'_second')),'{0,after,id}',to_jsonb(scope||'_second')));
 exception when sqlstate 'PT409' then rejected:=true; end;
 if not rejected then raise exception 'test_second_settlement_accepted'; end if; counter:=counter+1;
 select data into tx from public.store_wallet_transactions where id=scope||'_settle';
 rejected:=false;
 begin perform erp_private.commit_changes(gen_random_uuid(),jsonb_build_array(jsonb_build_object('table','store_wallet_transactions','id',tx->>'id','exists',true,'before',tx,'after',null)));
 exception when others then if sqlerrm<>'erp_loss_settlement_immutable' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'test_settlement_deletion_accepted'; end if; counter:=counter+1;
 select md5(coalesce(string_agg(data::text,',' order by id),'')) into after_cash from public.safe_transactions where data->>'_erpTestScope'=scope;
 if before_cash<>after_cash then raise exception 'test_vault_changed'; end if; counter:=counter+1;
 if (select count(*) from public.store_wallet_transactions where data->>'sourceType'='loss_settlement' and data->>'_erpTestScope'=scope)<>1 then raise exception 'test_settlement_duplicated'; end if;
 if counter<>11 then raise exception 'test_counter_failed %',counter; end if;
end $$;
rollback;
select 'PASS: 11 rollback-only server checks: deletion deficit, amount bounds, no cash mutation, admin guard, exact zero, idempotent retry, repeated settlement rejection, immutable audit, unchanged vault' as verification;
