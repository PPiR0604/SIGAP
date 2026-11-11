-- Isolated PostgreSQL fixture only. All fixture data rolls back.
\set ON_ERROR_STOP on
begin;
create temp table before_recovery as select * from public.sigap_entities;
\ir /tmp/recovery-migration.sql
\ir /tmp/recovery-migration.sql
do $$begin
 if exists((select * from before_recovery except select * from public.sigap_entities) union all
  (select * from public.sigap_entities except select * from before_recovery)) then raise exception 'MIGRATION_CHANGED_ROWS'; end if;
end$$;
insert into auth.users(id) values
 ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333'),('44444444-4444-4444-8444-444444444444'),
 ('55555555-5555-4555-8555-555555555555');
insert into public.sigap_organizations(id,name) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fixture'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Other');
insert into public.sigap_contexts values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ctx','Fixture'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','empty','Empty'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ctx','Other');
insert into public.sigap_memberships(user_id,organization_id,role,status,scopes) values
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','petugas','active','{ctx,empty}'),
 ('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin','active','{}'),
 ('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','viewer','active','{ctx}'),
 ('44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','petugas','disabled','{ctx}'),
 ('55555555-5555-4555-8555-555555555555','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','admin','active','{}');
insert into public.sigap_entities(kind,id,document) values
 ('sessions','mine','{"session_id":"mine","organization_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","context_id":"ctx","owner_user_id":"11111111-1111-4111-8111-111111111111","status":"closed"}'),
 ('sessions','foreign','{"session_id":"foreign","organization_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","context_id":"ctx","owner_user_id":"22222222-2222-4222-8222-222222222222"}'),
 ('sessions','empty','{"session_id":"empty","organization_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","context_id":"empty","owner_user_id":"11111111-1111-4111-8111-111111111111"}'),
 ('batches','old','{"batch_id":"old","session_id":"mine","status":"ready_for_review"}'),
 ('batches','new','{"batch_id":"new","session_id":"mine","status":"ready_for_review"}'),
 ('batches','running','{"batch_id":"running","session_id":"mine","status":"processing"}'),
 ('snapshots','old-s','{"snapshot_id":"old-s","batch_id":"old","superseded_by":null,"expires_at":"2999-01-01T00:00:00.000Z"}'),
 ('snapshots','new-s','{"snapshot_id":"new-s","batch_id":"new","superseded_by":null,"expires_at":"2999-01-01T00:00:00.000Z"}'),
 ('snapshots','expired-s','{"snapshot_id":"expired-s","batch_id":"new","superseded_by":null,"expires_at":"2026-11-09T00:00:00.000Z"}'),
 ('snapshots','superseded-s','{"snapshot_id":"superseded-s","batch_id":"new","superseded_by":"new-s","expires_at":"2999-01-01T00:00:00.000Z"}'),
 ('events','first','{"session_id":"mine","event_id":7}'),('events','latest','{"session_id":"mine","event_id":12}'),
 ('events','other','{"session_id":"foreign","event_id":999}');
insert into public.sigap_storage(organization_id,context_id,revision,document) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ctx',7,'{"header":["posko"],"rows":[["A"]]}');
create temp table fixture_recovery as select * from public.sigap_entities;
create function pg_temp.reject_recovery(args jsonb,expected text) returns void language plpgsql as $$begin
 begin
  perform public.sigap_dispatch('storage.read',args);raise exception 'EXPECTED_REJECTION';
 exception when others then if sqlerrm<>expected then raise; end if; end;
end$$;
do $$declare args jsonb; value jsonb; legacy jsonb; option jsonb; begin
 args:='{"actor_id":"11111111-1111-4111-8111-111111111111","context_id":"ctx","recovery_session_id":"mine","workspace_cutoff":"2026-11-09T00:00:00.000Z"}';
 value:=public.sigap_dispatch('storage.read',args);
 legacy:=public.sigap_dispatch('storage.read',args-'recovery_session_id'-'workspace_cutoff');
 if value-'recovery'<>legacy or value->'recovery'->>'session_id'<>'mine' or value->'recovery'->'after_event_id'<>'12'::jsonb then raise exception 'RECOVERY_STORAGE_CURSOR_WRONG: %',value; end if;
 legacy:=public.sigap_dispatch('entity.list','{"kind":"batches","filter":{"session_id":"mine"},"workspace_state":true,"workspace_cutoff":"2026-11-09T00:00:00.000Z"}');
 if value->'recovery'->'state'<>legacy or jsonb_array_length(legacy->'reviews')<>2 then raise exception 'RECOVERY_STATE_WRONG'; end if;
 value:=public.sigap_dispatch('storage.read',args||'{"actor_id":"22222222-2222-4222-8222-222222222222"}');
 if value->'recovery'->>'session_id'<>'mine' then raise exception 'ADMIN_DENIED'; end if;
 value:=public.sigap_dispatch('storage.read',args||'{"context_id":"empty","recovery_session_id":"empty"}');
 if value->'revision'<>'0'::jsonb or value->'document'<>'{"header":[],"rows":[]}'::jsonb or value->'recovery'->'after_event_id'<>'0'::jsonb
  or value->'recovery'->'state'<>'{"reviews":[],"activeBatch":null}'::jsonb then raise exception 'EMPTY_WRONG'; end if;
 perform pg_temp.reject_recovery(args||'{"recovery_session_id":"foreign"}','RECOVERY_SESSION_DENIED');
 perform pg_temp.reject_recovery(args||'{"recovery_session_id":"absent"}','RECOVERY_SESSION_DENIED');
 perform pg_temp.reject_recovery(args||'{"context_id":"empty"}','RECOVERY_SESSION_DENIED');
 perform pg_temp.reject_recovery(args||'{"actor_id":"55555555-5555-4555-8555-555555555555"}','RECOVERY_SESSION_DENIED');
 perform pg_temp.reject_recovery(args||'{"actor_id":"33333333-3333-4333-8333-333333333333"}','SCOPE_DENIED');
 perform pg_temp.reject_recovery(args||'{"actor_id":"44444444-4444-4444-8444-444444444444"}','ACCESS_DENIED');
 perform pg_temp.reject_recovery(args||'{"context_id":"unassigned"}','SCOPE_DENIED');
 for option in select v from jsonb_array_elements('[null,0,"",{},[]]') v loop
  perform pg_temp.reject_recovery(jsonb_set(args,'{recovery_session_id}',option),'RECOVERY_OPTIONS_INVALID');
 end loop;
 for option in select v from jsonb_array_elements('[null,0,"",{},[],"2026-11-09","2026-11-09T00:00:00Z"]') v loop
  perform pg_temp.reject_recovery(jsonb_set(args,'{workspace_cutoff}',option),'RECOVERY_OPTIONS_INVALID');
 end loop;
 if exists((select * from fixture_recovery except select * from public.sigap_entities) union all
  (select * from public.sigap_entities except select * from fixture_recovery)) then raise exception 'READ_CHANGED_ROWS'; end if;
 if (select revision<>7 or document<>'{"header":["posko"],"rows":[["A"]]}'::jsonb from public.sigap_storage where context_id='ctx') then raise exception 'STORAGE_CHANGED'; end if;
 if has_function_privilege('anon','public.sigap_dispatch(text,jsonb)','execute') or has_function_privilege('authenticated','public.sigap_dispatch(text,jsonb)','execute')
  or not has_function_privilege('service_role','public.sigap_dispatch(text,jsonb)','execute') or
  (select prosecdef from pg_proc where oid='public.sigap_dispatch(text,jsonb)'::regprocedure) then raise exception 'PRIVILEGES_CHANGED'; end if;
end$$;
rollback;
\echo Workspace recovery fixture passed.
