-- Isolated PostgreSQL fixture only. All fixture data rolls back.
\set ON_ERROR_STOP on
begin;
create temp table before_workspace as select * from public.sigap_entities;
\ir /tmp/workspace-migration.sql
\ir /tmp/workspace-migration.sql
do $$begin
 if exists((select * from before_workspace except select * from public.sigap_entities) union all
  (select * from public.sigap_entities except select * from before_workspace)) then raise exception 'MIGRATION_CHANGED_ROWS'; end if;
end$$;
insert into public.sigap_entities(kind,id,document) values
 ('batches','older','{"batch_id":"older","session_id":"mine","status":"ready_for_review","gap_payload_json":"gap-old"}'),
 ('batches','done','{"batch_id":"done","session_id":"mine","status":"done","filtered_text":"large history omitted"}'),
 ('batches','newer','{"batch_id":"newer","session_id":"mine","status":"ready_for_review","gap_payload_json":"gap-new"}'),
 ('batches','active','{"batch_id":"active","session_id":"mine","status":"saving"}'),
 ('batches','foreign','{"batch_id":"foreign","session_id":"other","status":"ready_for_review"}'),
 ('snapshots','old-one','{"snapshot_id":"old-one","batch_id":"older","superseded_by":null,"expires_at":"2999-01-01T00:00:00.000Z"}'),
 ('snapshots','new-one','{"snapshot_id":"new-one","batch_id":"newer","superseded_by":null,"expires_at":"2999-01-01T00:00:00.000Z"}'),
 ('snapshots','new-two','{"snapshot_id":"new-two","batch_id":"newer","superseded_by":null,"expires_at":"2999-01-01T00:00:00.000Z"}'),
 ('snapshots','expired','{"snapshot_id":"expired","batch_id":"newer","superseded_by":null,"expires_at":"2000-01-01T00:00:00.000Z"}'),
 ('snapshots','boundary','{"snapshot_id":"boundary","batch_id":"newer","superseded_by":null,"expires_at":"2026-11-09T00:00:00.000Z"}'),
 ('snapshots','superseded','{"snapshot_id":"superseded","batch_id":"newer","superseded_by":"new-two","expires_at":"2999-01-01T00:00:00.000Z"}'),
 ('snapshots','missing-null','{"snapshot_id":"missing-null","batch_id":"newer","expires_at":"2999-01-01T00:00:00.000Z"}'),
 ('snapshots','done-snapshot','{"snapshot_id":"done-snapshot","batch_id":"done","superseded_by":null,"expires_at":"2999-01-01T00:00:00.000Z"}'),
 ('snapshots','foreign-snapshot','{"snapshot_id":"foreign-snapshot","batch_id":"foreign","superseded_by":null,"expires_at":"2999-01-01T00:00:00.000Z"}'),
 ('events','workspace-event','{"session_id":"mine","event_id":3}');
create temp table fixture_workspace as select * from public.sigap_entities;
do $$declare args jsonb; value jsonb; filters jsonb; option jsonb;begin
 args:='{"kind":"batches","filter":{"session_id":"mine"},"workspace_state":true,"workspace_cutoff":"2026-11-09T00:00:00.000Z"}';
 value:=public.sigap_dispatch('entity.list',args);
 if (select jsonb_agg(row->'snapshot'->>'snapshot_id') from jsonb_array_elements(value->'reviews') row)<>'["new-two","new-one","old-one"]'::jsonb
  or value->'activeBatch'->>'batch_id'<>'active' or value->'reviews'->0->'batch'->>'gap_payload_json'<>'gap-new' then raise exception 'WORKSPACE_STATE_WRONG: %',value; end if;
 value:=public.sigap_dispatch('entity.list',args||'{"active_only":true}'::jsonb);
 if value->'reviews'<>'[]'::jsonb or value->'activeBatch'->>'batch_id'<>'active' then raise exception 'ACTIVE_ONLY_WRONG'; end if;
 value:=public.sigap_dispatch('entity.list',jsonb_set(args,'{filter,session_id}','"empty"'));
 if value<>'{"reviews":[],"activeBatch":null}'::jsonb then raise exception 'EMPTY_WRONG'; end if;
 value:=public.sigap_dispatch('entity.list',jsonb_set(args,'{filter,session_id}','"other"'));
 if jsonb_array_length(value->'reviews')<>1 or value->'reviews'->0->'snapshot'->>'snapshot_id'<>'foreign-snapshot' then raise exception 'ISOLATION_WRONG'; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"batches","filter":{"session_id":"mine"}}');
 if jsonb_array_length(value)<>4 then raise exception 'LEGACY_LIST_CHANGED'; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"events","filter":{"session_id":"mine"},"latest_event_id":true}');
 if value<>'3'::jsonb then raise exception 'CURSOR_CHANGED'; end if;
 value:=public.sigap_dispatch('entity.list','{"kind":"batches","filter":{"session_id":"mine"},"submission_state":true,"request_id":"mine:new"}');
 if value->>'activeBatchId'<>'active' or value->'firstTurn'<>'false'::jsonb then raise exception 'SUBMISSION_CHANGED'; end if;
 for filters in select v from jsonb_array_elements('[null,{}, {"session_id":null},{"session_id":0},{"session_id":""},{"session_id":"mine","status":"done"}]') v loop
  begin perform public.sigap_dispatch('entity.list',jsonb_set(args,'{filter}',filters));raise exception 'EXPECTED_SESSION_REJECTION';
  exception when others then if sqlerrm<>'WORKSPACE_SESSION_REQUIRED' then raise; end if; end;
 end loop;
 for option in select v from jsonb_array_elements('[null,0,"invalid","2026-11-09","2026-11-09T00:00:00Z"]') v loop
  begin perform public.sigap_dispatch('entity.list',jsonb_set(args,'{workspace_cutoff}',option));raise exception 'EXPECTED_OPTION_REJECTION';
  exception when others then if sqlerrm<>'WORKSPACE_OPTIONS_INVALID' then raise; end if; end;
 end loop;
 begin perform public.sigap_dispatch('entity.list',args||'{"active_only":null}'::jsonb);raise exception 'EXPECTED_ACTIVE_REJECTION';
 exception when others then if sqlerrm<>'WORKSPACE_OPTIONS_INVALID' then raise; end if; end;
 if exists((select * from fixture_workspace except select * from public.sigap_entities) union all
  (select * from public.sigap_entities except select * from fixture_workspace)) then raise exception 'READ_CHANGED_ROWS'; end if;
 if has_function_privilege('anon','public.sigap_dispatch(text,jsonb)','execute') or has_function_privilege('authenticated','public.sigap_dispatch(text,jsonb)','execute')
  or not has_function_privilege('service_role','public.sigap_dispatch(text,jsonb)','execute') or
  (select prosecdef from pg_proc where oid='public.sigap_dispatch(text,jsonb)'::regprocedure) then raise exception 'PRIVILEGES_CHANGED'; end if;
end$$;
rollback;
\echo Workspace state fixture passed.
