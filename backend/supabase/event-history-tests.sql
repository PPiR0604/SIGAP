-- Local PostgreSQL fixture only; never execute these fixture inserts on hosted Supabase.
\set ON_ERROR_STOP on
begin;
insert into public.sigap_entities(kind,id,document) values
 ('events','cursor-one','{"session_id":"cursor-mine","event_id":10,"event_type":"stored_rekap_ready"}'),
 ('events','cursor-three','{"session_id":"cursor-mine","event_id":30,"event_type":"stage_changed"}'),
 ('events','cursor-two','{"session_id":"cursor-mine","event_id":20,"event_type":"stage_changed"}'),
 ('events','cursor-foreign','{"session_id":"cursor-other","event_id":999,"event_type":"stage_changed"}'),
 ('batches','cursor-not-event','{"session_id":"cursor-mine","event_id":9999}');
create temp table before_events as select * from public.sigap_entities;
\ir /tmp/event-migration.sql
\ir /tmp/event-migration.sql
do $$
declare value jsonb;
begin
 if exists((select * from before_events except select * from public.sigap_entities)
  union all (select * from public.sigap_entities except select * from before_events)) then raise exception 'ROWS_CHANGED'; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"events","filter":{"session_id":"cursor-mine"},"latest_event_id":true}');
 if value<>'30'::jsonb then raise exception 'CURSOR_WRONG: %',value; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"events","filter":{"session_id":"empty"},"latest_event_id":true}');
 if value<>'0'::jsonb then raise exception 'EMPTY_CURSOR_WRONG'; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"events","filter":{"session_id":"cursor-mine","event_type":"stored_rekap_ready"},"latest_event_id":true}');
 if value<>'10'::jsonb then raise exception 'EXTRA_FILTER_IGNORED'; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"events","filter":{"session_id":"cursor-mine"},"after_event_id":10}');
 if jsonb_path_query_array(value,'$[*].event_id')<>'[20,30]'::jsonb then raise exception 'REPLAY_WRONG: %',value; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"events","filter":{"session_id":"cursor-mine"},"after_event_id":30}');
 if value<>'[]'::jsonb then raise exception 'REPLAY_NOT_EMPTY'; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"events","filter":{"session_id":"cursor-mine"}}');
 if jsonb_array_length(value)<>3 then raise exception 'LEGACY_LIST_CHANGED'; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"batches","filter":{"session_id":"cursor-mine"}}');
 if jsonb_array_length(value)<>1 then raise exception 'OTHER_ENTITY_CHANGED'; end if;
 if has_function_privilege('anon','public.sigap_dispatch(text,jsonb)','execute') or
    has_function_privilege('authenticated','public.sigap_dispatch(text,jsonb)','execute') or
    not has_function_privilege('service_role','public.sigap_dispatch(text,jsonb)','execute') then raise exception 'RPC_PRIVILEGES_CHANGED'; end if;
 if (select prosecdef from pg_proc where oid='public.sigap_dispatch(text,jsonb)'::regprocedure) then raise exception 'INVOKER_CHANGED'; end if;
 begin
  perform public.sigap_dispatch('entity.list','{"kind":"events","latest_event_id":true}');
  raise exception 'EXPECTED_SESSION_REJECTION';
 exception when others then if sqlerrm<>'EVENT_SESSION_REQUIRED' then raise; end if; end;
 for value in select v from jsonb_array_elements('[-1,1.5,"10",null,9007199254740992]') v loop
  begin
   perform public.sigap_dispatch('entity.list',jsonb_build_object('kind','events','filter',jsonb_build_object('session_id','cursor-mine'),'after_event_id',value));
   raise exception 'EXPECTED_CURSOR_REJECTION';
  exception when others then if sqlerrm<>'EVENT_CURSOR_INVALID' then raise; end if; end;
 end loop;
end $$;
set local role service_role;
select public.sigap_dispatch('entity.list','{"kind":"events","filter":{"session_id":"cursor-mine"},"latest_event_id":true}')='30'::jsonb as service_cursor;
reset role;
rollback;
