do $qa$
declare scope text:='__qa_jkr_rpc_'||replace(gen_random_uuid()::text,'-','');uid uuid;sid uuid:=gen_random_uuid();actor jsonb;w jsonb;l jsonb;tx jsonb;after_tx jsonb;bad jsonb;good jsonb;op uuid:=gen_random_uuid();r jsonb;blocked boolean;k text;
begin
 begin
 actor:=jsonb_build_object('id',scope||'_owner','username',scope,'fullName','Inventory guard rollback QA','role','admin','isActive',true,'password',gen_random_uuid()::text,'permissions',jsonb_build_array('view','add','edit','delete','manage_finance'),'_erpTestScope',scope);
 insert into public.users(id,data) values(actor->>'id',actor-'password');uid:=erp_private.sync_identity(actor);update erp_private.members set test_scope=scope where auth_id=uid;
 insert into auth.sessions(id,user_id) values(sid,uid);perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',sid)::text,true);
 w:='[{"id":"FAZER-QA","type":"SUB","pointsBalance":102.46}]';l:='[{"id":"fifo","walletId":"FAZER-QA","currencyOrPoints":"POINTS","initialQuantity":200,"remainingQuantity":102.46}]';
 tx:='[{"id":"consume","walletId":"FAZER-QA","transactionType":"CONSUMPTION","status":"COMPLETED","ticketId":"QA","quantityOut":97.54}]';
 insert into public.system_kv(key,value) values(scope||':jkr_wallets_v2',w),(scope||':jkr_wallet_lots_v2',l),(scope||':jkr_wallet_transactions_v2',tx);
 after_tx:=jsonb_build_array(jsonb_build_object('id','returned','walletId','FAZER-QA','transactionType','REVERSAL','referenceType','TICKET','ticketId','QA','referenceId','QA','quantityIn',97.54))||jsonb_set(tx,'{0,status}','"CANCELLED"');
 bad:=jsonb_build_array(jsonb_build_object('table','system_kv','id','jkr_wallets_v2','exists',true,'before',w,'after',jsonb_set(w,'{0,pointsBalance}','297.54')),jsonb_build_object('table','system_kv','id','jkr_wallet_lots_v2','exists',true,'before',l,'after',jsonb_set(l,'{0,remainingQuantity}','200')),jsonb_build_object('table','system_kv','id','jkr_wallet_transactions_v2','exists',true,'before',tx,'after',after_tx));
 blocked:=false;begin perform public.erp_commit_changes(gen_random_uuid(),bad);exception when sqlstate 'PT409' then blocked:=true;end;if not blocked then raise exception 'duplicate_refund_rpc_accepted';end if;
 if (select value from public.system_kv where key=scope||':jkr_wallets_v2')<>w or (select value from public.system_kv where key=scope||':jkr_wallet_lots_v2')<>l or (select value from public.system_kv where key=scope||':jkr_wallet_transactions_v2')<>tx then raise exception 'partial_guard_write';end if;
 good:=jsonb_set(bad,'{0,after,0,pointsBalance}','200');r:=public.erp_commit_changes(op,good);
 if (select value#>>'{0,pointsBalance}' from public.system_kv where key=scope||':jkr_wallets_v2')<>'200' or (select value#>>'{0,remainingQuantity}' from public.system_kv where key=scope||':jkr_wallet_lots_v2')<>'200' then raise exception 'funded_refund_rpc_failed';end if;
 if public.erp_commit_changes(op,good)<>r then raise exception 'refund_rpc_retry_not_idempotent';end if;
 blocked:=false;begin perform public.erp_commit_changes(gen_random_uuid(),good);exception when sqlstate 'PT409' then blocked:=true;end;if not blocked then raise exception 'stale_refund_replay';end if;
 if has_function_privilege('authenticated','erp_private.validate_inventory_refund(jsonb,jsonb)','execute') then raise exception 'inventory_guard_exposed';end if;
 raise exception using errcode='ZX001',message='six_rpc_checks_passed';
 exception when sqlstate 'ZX001' then null;end;
end $qa$;
select 'PASS: six RPC checks — duplicate rejected, zero partial writes, exact 200 restored, retry idempotent, stale replay rejected, private validator' verification;
