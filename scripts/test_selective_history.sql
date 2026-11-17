
do $qa$
declare scope text:='__qa_hist_'||replace(gen_random_uuid()::text,'-',''); uid uuid;sid uuid:=gen_random_uuid();profile jsonb;first_op uuid:=gen_random_uuid();second_op uuid:=gen_random_uuid();replay_op uuid:=gen_random_uuid();payload jsonb;result jsonb;actual jsonb;blocked boolean;idx int;
begin
 begin
 profile:=jsonb_build_object('id',scope||'_user','username',scope,'fullName','History rollback QA','role','admin','isActive',true,'password',gen_random_uuid()::text,'permissions',jsonb_build_array('view','add','edit','delete','manage_finance'),'_erpTestScope',scope);
 insert into public.users(id,data) values(profile->>'id',profile-'password');uid:=erp_private.sync_identity(profile);
 update erp_private.members set test_scope=scope where auth_id=uid;insert into auth.sessions(id,user_id) values(sid,uid);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',sid)::text,true);
 payload:=jsonb_build_array(jsonb_build_object('table','customers','id',scope||'_a','exists',false,'before',null,'after',jsonb_build_object('id',scope||'_a','fullName','A','_erpTestScope',scope)));
 result:=public.erp_commit_changes(first_op,payload);
 if public.erp_commit_changes(first_op,payload)<>result or jsonb_array_length(public.erp_action_history())<>1 then raise exception 'history_idempotency';end if;
 perform public.erp_commit_changes(second_op,jsonb_build_array(jsonb_build_object('table','customers','id',scope||'_b','exists',false,'before',null,'after',jsonb_build_object('id',scope||'_b','fullName','B','_erpTestScope',scope))));
 result:=public.erp_replay_action(first_op,'undo',replay_op);
 if exists(select 1 from public.customers where id=scope||'_a') or not exists(select 1 from public.customers where id=scope||'_b') then raise exception 'selected_undo_overwrote_newer';end if;
 if public.erp_replay_action(first_op,'undo',replay_op)<>result then raise exception 'replay_not_idempotent';end if;
 perform public.erp_replay_action(first_op,'redo',gen_random_uuid());
 if not exists(select 1 from public.customers where id=scope||'_a') then raise exception 'redo_failed';end if;
 select data into actual from public.customers where id=scope||'_a';
 perform public.erp_commit_changes(gen_random_uuid(),jsonb_build_array(jsonb_build_object('table','customers','id',scope||'_a','exists',true,'before',actual,'after',actual||'{"fullName":"A changed"}')));
 blocked:=false;begin perform public.erp_replay_action(first_op,'undo',gen_random_uuid());exception when sqlstate 'PT409' then blocked:=true;end;
 if not blocked or (select data->>'fullName' from public.customers where id=scope||'_a')<>'A changed' then raise exception 'stale_selective_undo_accepted';end if;
 for idx in 1..12 loop
 perform public.erp_commit_changes(gen_random_uuid(),jsonb_build_array(jsonb_build_object('table','customers','id',scope||'_'||idx,'exists',false,'before',null,'after',jsonb_build_object('id',scope||'_'||idx,'fullName','retention','_erpTestScope',scope))));
 end loop;
 if jsonb_array_length(public.erp_action_history())<>10 then raise exception 'history_retention';end if;
 blocked:=false;begin perform public.erp_replay_action(first_op,'undo',gen_random_uuid());exception when sqlstate '42501' then blocked:=true;end;if not blocked then raise exception 'evicted_action_accessible';end if;
 perform set_config('request.jwt.claims','{}',true);blocked:=false;begin perform public.erp_action_history();exception when sqlstate '42501' then blocked:=true;end;if not blocked then raise exception 'unauthenticated_history';end if;
 if has_function_privilege('anon','public.erp_action_history()','execute') or has_function_privilege('authenticated','erp_private.commit_changes(uuid,jsonb)','execute') then raise exception 'unsafe_grants';end if;
 raise exception using errcode='ZX001',message='qa_pass';
 exception when sqlstate 'ZX001' then null;
 end;
end $qa$;
