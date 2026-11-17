-- Actual RPC implementation, rollback-only isolated QA scope. No live data reset.
begin;
do $$
declare scope text:='__qa_maintenance_'||replace(gen_random_uuid()::text,'-',''); profile jsonb; uid uuid; sid uuid:=gen_random_uuid();
 snap jsonb; after_snap jsonb; row_data jsonb; rejected boolean; payload jsonb; result jsonb; op uuid:=gen_random_uuid(); rev text;
 wallet_id text; ticket_id text; old_user jsonb; proof text;
begin
 profile:=jsonb_build_object('id',scope||'_user','username',scope,'fullName','Rollback-only maintenance test','role','admin','isActive',true,
 'password',gen_random_uuid()::text,'permissions',jsonb_build_array('view','add','edit','manage_finance'),'_erpTestScope',scope);
 insert into public.users(id,data) values(profile->>'id',profile-'password'); uid:=erp_private.sync_identity(profile);
 update erp_private.members set test_scope=scope where auth_id=uid;
 insert into auth.sessions(id,user_id) values(sid,uid);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',sid)::text,true);
 select data into old_user from public.users where id=profile->>'id';
 wallet_id:=scope||'_wallet';ticket_id:=scope||'_ticket';
 insert into public.store_wallets(id,data) values(wallet_id,jsonb_build_object('id',wallet_id,'balance',55,'_erpTestScope',scope));
 insert into public.tickets(id,data) values(ticket_id,jsonb_build_object('id',ticket_id,'netProfit',23,'status','completed','_erpTestScope',scope));
 insert into public.safe_transactions(id,data) values(scope||'_safe',jsonb_build_object('id',scope||'_safe','amount',17,'_erpTestScope',scope));
 -- A loss settlement must be reset/restored by maintenance without weakening ordinary posting guards.
 insert into public.store_wallet_transactions(id,data) values(scope||'_loss',jsonb_build_object('id',scope||'_loss','walletId','w_profits','type','adjustment','sourceType','loss_settlement','amount',3,'_erpTestScope',scope));
 insert into public.system_kv(key,value) values(scope||':games_tree','[{"id":"game-with-products","children":[{"id":"product"}]}]'),(scope||':jkr_wallet_lots_v2','[{"id":"fifo-lot","remaining":20}]'),(scope||':settings','{"vaultInitialBalance":9}');
 insert into public.customer_notes(id,data) select scope||'_note_'||i,jsonb_build_object('id',scope||'_note_'||i,'text','row '||i,'_erpTestScope',scope) from generate_series(1,1105)i;
 snap:=public.erp_export_backup();
 if jsonb_array_length(snap#>'{tables,customer_notes}')<>1105 or snap#>'{tables,users}' is not null or snap#>'{kv,jkr_wallet_lots_v2}' is null then raise exception 'test_export_incomplete_or_identity_exposed'; end if;
 payload:=jsonb_build_object('tables',snap->'tables','kv',snap->'kv','replaceKv',true);rev:=snap->>'revision';
 -- Invalid imports and identity-table injection must fail without changing anything.
 rejected:=false;
 begin perform public.erp_maintain_data(gen_random_uuid(),'restore',jsonb_set(payload,'{tables,tickets}','[{"id":"duplicate"},{"id":"duplicate"}]'),rev);
 exception when others then if sqlerrm<>'erp_invalid_backup_ids' then raise; end if; rejected:=true; end;
 if not rejected or (public.erp_export_backup())->>'revision'<>rev then raise exception 'test_invalid_import_mutated_data'; end if;
 rejected:=false;
 begin perform public.erp_maintain_data(gen_random_uuid(),'restore',jsonb_set(payload,'{tables,users}','[]'),rev);
 exception when others then if sqlerrm<>'erp_invalid_backup_table' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'test_user_import_accepted'; end if;
 -- Stale snapshot cannot overwrite newer records.
 rejected:=false;
 begin perform public.erp_maintain_data(gen_random_uuid(),'wipe_all','{}','wrong-revision'); exception when sqlstate 'PT409' then rejected:=true; end;
 if not rejected then raise exception 'test_stale_reset_accepted'; end if;
 -- Treasury reset leaves tickets/wallet balances/FIFO/catalog intact and zeros the vault.
 perform public.erp_maintain_data(gen_random_uuid(),'wipe_finance','{}',rev);
 after_snap:=public.erp_export_backup();
 if jsonb_array_length(after_snap#>'{tables,safe_transactions}')<>0 or after_snap#>>'{kv,settings,vaultInitialBalance}'<>'0'
 or after_snap#>'{tables,tickets}' is distinct from snap#>'{tables,tickets}' or after_snap#>'{tables,store_wallets}' is distinct from snap#>'{tables,store_wallets}'
 or after_snap#>'{kv,jkr_wallet_lots_v2}' is distinct from snap#>'{kv,jkr_wallet_lots_v2}' then raise exception 'test_finance_scope_failed'; end if;
 -- Restore replaces represented tables; credentials stay exactly unchanged.
 perform public.erp_maintain_data(gen_random_uuid(),'restore',payload,after_snap->>'revision');
 after_snap:=public.erp_export_backup();
 if after_snap#>'{tables,customer_notes}' is distinct from snap#>'{tables,customer_notes}' or after_snap#>'{tables,store_wallet_transactions}' is distinct from snap#>'{tables,store_wallet_transactions}'
 or after_snap#>'{kv,jkr_wallet_lots_v2}' is distinct from snap#>'{kv,jkr_wallet_lots_v2}' then raise exception 'test_restore_roundtrip_failed'; end if;
 rev:=after_snap->>'revision';
 result:=public.erp_maintain_data(op,'wipe_all','{}',rev);
 after_snap:=public.erp_export_backup();
 if jsonb_array_length(after_snap#>'{tables,tickets}')<>0 or jsonb_array_length(after_snap#>'{tables,store_wallet_transactions}')<>0
 or jsonb_array_length(after_snap#>'{tables,customer_notes}')<>0 or after_snap#>'{kv,jkr_wallet_lots_v2}' is not null then raise exception 'test_full_reset_incomplete'; end if;
 if (select data from public.users where id=profile->>'id') is distinct from old_user or not exists(select 1 from auth.sessions where id=sid) then raise exception 'test_identity_or_session_changed'; end if;
 if not exists(select 1 from erp_private.release_backup where table_name='maintenance:'||op::text and rows#>'{snapshot,tables,tickets}' is not null) then raise exception 'test_safety_snapshot_missing'; end if;
 if public.erp_maintain_data(op,'wipe_all','{}',rev) is distinct from result then raise exception 'test_retry_not_idempotent'; end if;
 -- Restore after full wipe, including original loss settlement and FIFO.
 perform public.erp_maintain_data(gen_random_uuid(),'restore',payload,after_snap->>'revision');
 after_snap:=public.erp_export_backup();
 if after_snap#>'{tables,tickets}' is distinct from snap#>'{tables,tickets}' or after_snap#>'{tables,store_wallets}' is distinct from snap#>'{tables,store_wallets}'
 or after_snap#>'{kv,games_tree}' is distinct from snap#>'{kv,games_tree}' then raise exception 'test_wipe_restore_failed'; end if;
 update public.users set data=jsonb_set(data,'{role}','"employee"') where id=profile->>'id';
 rejected:=false;
 begin perform public.erp_maintain_data(gen_random_uuid(),'wipe_all','{}',after_snap->>'revision'); exception when sqlstate '42501' then rejected:=true; end;
 if not rejected then raise exception 'test_employee_reset_allowed'; end if;
 rejected:=false;
 begin perform public.erp_export_backup(); exception when sqlstate '42501' then rejected:=true; end;
 if not rejected then raise exception 'test_employee_export_allowed'; end if;
end $$;
rollback;
select 'PASS: isolated rollback-only server export (>1000 rows), malformed import rollback, identity exclusion, stale revision conflict, treasury scope, full reset/restore with FIFO and loss settlement, private pre-change snapshot, unchanged Auth session, safe retry, employee denial' as verification;
