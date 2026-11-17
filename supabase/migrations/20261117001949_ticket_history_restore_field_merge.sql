-- Nine isolated PostgreSQL 17.11 tests passed before this patch. This modifies only replay of recorded ticket deletions and read-only action labels; financial conflicts stay PT409; the financial commit validator and its grants are unchanged. No business rows or archive files are changed by this migration.

-- A three-way merge only for restoring/deleting an already recorded ticket.
-- Unchanged fields are preserved. Financial conflicts remain conflicts.
create or replace function erp_private.merge_ticket_history(p_actual jsonb,p_expected jsonb,p_wanted jsonb,p_path text default '')
returns jsonb language plpgsql immutable security invoker set search_path='' as $fn$
declare result jsonb; k text; v jsonb; e jsonb; w jsonb; id text; item jsonb; matched boolean;
begin
 if p_expected is not distinct from p_wanted then return p_actual;end if;
 -- A newer timestamp is metadata, never a reason to overwrite newer business data.
 if p_path ~ '\.(updatedAt|lastUpdated|lastModified)$' and p_actual is distinct from p_expected then return p_actual;end if;
 if p_actual is not distinct from p_expected then return p_wanted;end if;
 if jsonb_typeof(p_actual)='object' and jsonb_typeof(p_expected)='object' and jsonb_typeof(p_wanted)='object' then
  result:=p_actual;
  for k in select key from jsonb_object_keys(p_expected||p_wanted) key loop
   if p_expected->k is not distinct from p_wanted->k then continue;end if;
   v:=erp_private.merge_ticket_history(p_actual->k,p_expected->k,p_wanted->k,p_path||'.'||k);
   if v is null then result:=result-k;else result:=jsonb_set(result,array[k],v,true);end if;
  end loop;
  return result;
 end if;
 if jsonb_typeof(p_actual)='array' and jsonb_typeof(p_expected)='array' and jsonb_typeof(p_wanted)='array' then
  -- Arrays may be selectively merged only with unique, stable object IDs.
  if exists(select 1 from jsonb_array_elements(p_actual||p_expected||p_wanted) x where jsonb_typeof(x)<>'object' or nullif(x->>'id','') is null)
   or (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p_actual)x)
   or (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p_expected)x)
   or (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p_wanted)x)
  then raise exception using errcode='PT409',message='erp_history_collection_conflict',detail=p_path;end if;
  result:='[]';
  for item in select value from jsonb_array_elements(p_actual) loop
   id:=item->>'id';
   select value into e from jsonb_array_elements(p_expected) where value->>'id'=id;
   select value into w from jsonb_array_elements(p_wanted) where value->>'id'=id;
   if e is not distinct from w then v:=item;else v:=erp_private.merge_ticket_history(item,e,w,p_path||'['||id||']');end if;
   if v is not null then result:=result||jsonb_build_array(v);end if;
  end loop;
  -- A touched item missing from current data is checked as rigorously as an existing item.
  for id in select key from (select x->>'id' key from jsonb_array_elements(p_expected||p_wanted)x)s group by key loop
   if exists(select 1 from jsonb_array_elements(p_actual)x where x->>'id'=id) then continue;end if;
   select value into e from jsonb_array_elements(p_expected) where value->>'id'=id;
   select value into w from jsonb_array_elements(p_wanted) where value->>'id'=id;
   if e is not distinct from w then continue;end if;
   v:=erp_private.merge_ticket_history(null,e,w,p_path||'['||id||']');
   if v is not null then result:=result||jsonb_build_array(v);end if;
  end loop;
  return result;
 end if;
 raise exception using errcode='PT409',message='erp_history_financial_conflict',detail=p_path;
end $fn$;
revoke execute on function erp_private.merge_ticket_history(jsonb,jsonb,jsonb,text) from public,anon,authenticated;


-- Only ticket deletion history gets field/item-aware replay. Other history retains
-- its exact expected-state checks. No financial conflict is silently rebased.
do $patch$
declare definition text; original text; replacement text;
begin
 select pg_get_functiondef('public.erp_replay_action(uuid,text,uuid)'::regprocedure) into definition;
 if position('merge_ticket_history(' in definition)>0 then raise exception 'ticket_history_patch_already_applied';end if;
 original:=$old$ for c in select value from jsonb_array_elements(h.changes) loop
  if p_direction='undo' then c:=jsonb_build_object('table',c->>'table','id',c->>'id','exists',c->'after'<>'null'::jsonb,'before',c->'after','after',c->'before');end if;
  changes:=changes||jsonb_build_array(c);
 end loop;$old$;
 replacement:=$new$
 ticket_deletion:=exists(select 1 from jsonb_array_elements(h.changes) x where x->>'table' in ('tickets','dealer_tickets') and x->'after'='null'::jsonb and jsonb_typeof(x->'before')='object');
 if ticket_deletion and exists(select 1 from jsonb_array_elements(h.changes) x where x->>'table' in ('tickets','dealer_tickets') and (nullif(x#>>'{before,shiftSettlementId}','') is not null or nullif(x#>>'{before,settledAt}','') is not null)) then
  raise exception using errcode='PT409',message='الوردية مغلقة؛ استعادة الأثر المالي تتطلب تسوية مستقلة';
 end if;
 for c in select value from jsonb_array_elements(h.changes) loop
  if p_direction='undo' then c:=jsonb_build_object('table',c->>'table','id',c->>'id','exists',c->'after'<>'null'::jsonb,'before',c->'after','after',c->'before');end if;
  table_name:=c->>'table';logical_id:=c->>'id';
  if ticket_deletion and table_name in ('customers','dealers','system_kv') then
   if table_name='system_kv' then
    if h.scope<>'' then logical_id:=h.scope||':'||logical_id;end if;
    select value into current_data from public.system_kv where key=logical_id for update;
   else
    execute format('select data from public.%I where id=$1 for update',table_name) into current_data using logical_id;
   end if;
   current_data:=coalesce(current_data,'null'::jsonb);
   next_data:=erp_private.merge_ticket_history(current_data,c->'before',c->'after',table_name||'.'||logical_id);
   if next_data is not distinct from current_data then continue;end if;
   c:=jsonb_build_object('table',table_name,'id',c->>'id','exists',current_data<>'null'::jsonb,'before',current_data,'after',next_data);
  end if;
  changes:=changes||jsonb_build_array(c);
 end loop;$new$;
 if position(original in definition)=0 then raise exception 'unexpected_replay_definition';end if;
 definition:=replace(definition,'receipt erp_private.commit_receipts%rowtype;','receipt erp_private.commit_receipts%rowtype; current_data jsonb;next_data jsonb;logical_id text;table_name text;ticket_deletion boolean;');
 if position('ticket_deletion boolean;' in definition)=0 then raise exception 'unexpected_replay_declarations';end if;
 definition:=replace(definition,original,replacement);
 execute definition;
end $patch$;

-- Ticket deletion labels are rendered from their own record, not database table names.
create or replace function public.erp_action_history() returns jsonb language plpgsql security definer set search_path='' as $fn$
declare a jsonb:=erp_private.actor(); result jsonb;
begin
 if a is null then raise exception using errcode='42501',message='erp_auth_required';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',h.id,
 'description',coalesce((select 'حذف تذكرة '||coalesce(x#>>'{before,ticketNumber}',x->>'id')||' — '||case x#>>'{before,status}' when 'completed' then 'تم الشحن' when 'refunded' then 'مستردة' when 'cancelled' then 'ملغاة' else 'الحالة: '||coalesce(x#>>'{before,status}','غير محددة') end from jsonb_array_elements(h.changes) x where x->>'table' in ('tickets','dealer_tickets') and x->'after'='null'::jsonb and jsonb_typeof(x->'before')='object' limit 1),h.description),
 'timestamp',h.created_at,'state',h.state,'blockedReason',h.blocked_reason
 ) order by h.created_at desc,h.id desc),'[]') into result
 from erp_private.action_history h where h.actor=auth.uid() and h.scope=coalesce(a->>'_testScope','');
 return result;
end $fn$;
revoke execute on function public.erp_action_history() from public,anon;
grant execute on function public.erp_action_history() to authenticated;
;

