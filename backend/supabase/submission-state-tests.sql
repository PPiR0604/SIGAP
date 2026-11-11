-- Isolated PostgreSQL fixture only. Never insert these rows into hosted Supabase.
\set ON_ERROR_STOP on
begin;
insert into public.sigap_entities(kind,id,document) values
 ('batches','submission-previous','{"batch_id":"submission-previous","session_id":"mine","request_id":"mine:retry","status":"ready_for_review","filtered_text":"synthetic"}'),
 ('batches','submission-active','{"batch_id":"submission-active","session_id":"mine","request_id":"mine:active","status":"verifying"}'),
 ('batches','submission-other','{"batch_id":"submission-other","session_id":"other","request_id":"other:retry","status":"processing"}'),
 ('events','submission-event','{"session_id":"mine","event_id":5}');
create temp table before_submission as select * from public.sigap_entities;
\ir /tmp/submission-migration.sql
\ir /tmp/submission-migration.sql
do $$
declare value jsonb; filter jsonb; request jsonb;
begin
 if exists((select * from before_submission except select * from public.sigap_entities)
  union all (select * from public.sigap_entities except select * from before_submission)) then raise exception 'ROWS_CHANGED'; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"batches","filter":{"session_id":"mine"},"submission_state":true,"request_id":"mine:retry"}');
 if value->'existingBatch' is distinct from (select document from public.sigap_entities where id='submission-previous')
    or value->>'activeBatchId'<>'submission-active' or value->'firstTurn'<>'false'::jsonb then raise exception 'STATE_WRONG: %',value; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"batches","filter":{"session_id":"mine"},"submission_state":true,"request_id":"mine:missing"}');
 if value->'existingBatch'<>'null'::jsonb or value->'firstTurn'<>'false'::jsonb then raise exception 'MISSING_RETRY_WRONG'; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"batches","filter":{"session_id":"empty"},"submission_state":true,"request_id":"empty:retry"}');
 if value<>'{"existingBatch":null,"activeBatchId":null,"firstTurn":true}'::jsonb then raise exception 'EMPTY_STATE_WRONG'; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"batches","filter":{"session_id":"other"},"submission_state":true,"request_id":"other:retry"}');
 if value->'existingBatch'->>'batch_id'<>'submission-other' or value->>'activeBatchId'<>'submission-other' then raise exception 'SESSION_ISOLATION_WRONG'; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"events","filter":{"session_id":"mine"},"latest_event_id":true}');
 if value<>'5'::jsonb then raise exception 'EVENT_CURSOR_CHANGED'; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"batches","filter":{"session_id":"mine"}}');
 if jsonb_array_length(value)<>2 then raise exception 'LEGACY_LIST_CHANGED'; end if;
 for filter in select v from jsonb_array_elements('[null,{}, {"session_id":null},{"session_id":12},{"session_id":""},{"session_id":"mine","status":"done"}]') v loop
  begin
   perform public.sigap_dispatch('entity.list',jsonb_build_object('kind','batches','filter',filter,'submission_state',true,'request_id','mine:retry'));
   raise exception 'EXPECTED_SESSION_REJECTION';
  exception when others then if sqlerrm<>'SUBMISSION_SESSION_REQUIRED' then raise; end if; end;
 end loop;
 for request in select v from jsonb_array_elements('[null,12,"","other:retry","mine:","mine-other:retry"]') v loop
  begin
   perform public.sigap_dispatch('entity.list',jsonb_build_object('kind','batches','filter',jsonb_build_object('session_id','mine'),'submission_state',true,'request_id',request));
   raise exception 'EXPECTED_REQUEST_REJECTION';
  exception when others then if sqlerrm<>'SUBMISSION_REQUEST_INVALID' then raise; end if; end;
 end loop;
 if has_function_privilege('anon','public.sigap_dispatch(text,jsonb)','execute') or
    has_function_privilege('authenticated','public.sigap_dispatch(text,jsonb)','execute') or
    not has_function_privilege('service_role','public.sigap_dispatch(text,jsonb)','execute') then raise exception 'PRIVILEGES_CHANGED'; end if;
 if (select prosecdef from pg_proc where oid='public.sigap_dispatch(text,jsonb)'::regprocedure) then raise exception 'INVOKER_CHANGED'; end if;
 begin
  insert into public.sigap_entities(kind,id,document) values('batches','duplicate-request','{"session_id":"mine","request_id":"mine:retry","status":"done"}');
  raise exception 'REQUEST_UNIQUENESS_LOST';
 exception when unique_violation then null; end;
 begin
  insert into public.sigap_entities(kind,id,document) values('batches','duplicate-active','{"session_id":"mine","request_id":"mine:new","status":"processing"}');
  raise exception 'ACTIVE_UNIQUENESS_LOST';
 exception when unique_violation then null; end;
 update public.sigap_entities set document=document||'{"status":"done"}' where id='submission-active';
 value:=public.sigap_dispatch('entity.list','{"kind":"batches","filter":{"session_id":"mine"},"submission_state":true,"request_id":"mine:new"}');
 if value->'activeBatchId'<>'null'::jsonb or value->'firstTurn'<>'false'::jsonb then raise exception 'TERMINAL_STATE_WRONG'; end if;
end $$;
set local role service_role;
select public.sigap_dispatch('entity.list','{"kind":"batches","filter":{"session_id":"mine"},"submission_state":true,"request_id":"mine:retry"}')->>'activeBatchId' is null as service_read;
reset role;
rollback;
