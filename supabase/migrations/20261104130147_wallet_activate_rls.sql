-- Activate only after the authenticated client has been built and staged.
-- The protected pre-release snapshot remains in erp_private.release_backup.
do $$ declare t record; p record; begin
 for t in select table_name from erp_private.entities loop
  execute format('alter table public.%I enable row level security',t.table_name);
  for p in select policyname from pg_policies where schemaname='public' and tablename=t.table_name loop
   execute format('drop policy %I on public.%I',p.policyname,t.table_name);
  end loop;
  execute format('revoke all on public.%I from anon',t.table_name);
  execute format('revoke insert,update,delete,truncate,references,trigger on public.%I from authenticated',t.table_name);
  execute format('grant select on public.%I to authenticated',t.table_name);
  if t.table_name='system_kv' then
   execute format('create policy erp_read on public.%I for select to authenticated using (erp_private.can_read(%L,key,value))',t.table_name,t.table_name);
  else
   execute format('create policy erp_read on public.%I for select to authenticated using (erp_private.can_read(%L,id,data))',t.table_name,t.table_name);
  end if;
 end loop;
end $$;
-- Passwords now exist only as Auth hashes, not downloadable public profile fields.
update public.users set data=(data-'password')||jsonb_build_object('hasPassword',true),updated_at=now() where data?'password';
delete from public.system_kv where key in ('current_user','nzm_jkr_current_user');
revoke all on function public.rls_auto_enable() from public,anon,authenticated;
-- Ensure high-traffic data actually publishes changes for authenticated Realtime.
do $$ declare t text; begin
 foreach t in array array['tickets','dealer_tickets','store_wallets','store_wallet_transactions','dealer_wallets','dealer_wallet_transactions','customers','dealers','safe_transactions','dealer_safe_transactions','system_kv'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
   execute format('alter publication supabase_realtime add table public.%I',t);
  end if;
 end loop;
end $$;
notify pgrst,'reload schema';
