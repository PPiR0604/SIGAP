-- Isolated PostgreSQL fixture only. Never insert fixture rows into hosted Supabase.
\set ON_ERROR_STOP on
begin;
create temp table before_review as select * from public.sigap_entities;
\ir /tmp/review-migration.sql
\ir /tmp/review-migration.sql
do $$begin
 if exists((select * from before_review except select * from public.sigap_entities)
   union all(select * from public.sigap_entities except select * from before_review)) then raise exception 'MIGRATION_CHANGED_ROWS'; end if;
 if has_function_privilege('anon','public.sigap_dispatch(text,jsonb)','execute') or
    has_function_privilege('authenticated','public.sigap_dispatch(text,jsonb)','execute') or
    not has_function_privilege('service_role','public.sigap_dispatch(text,jsonb)','execute') or
    (select prosecdef from pg_proc where oid='public.sigap_dispatch(text,jsonb)'::regprocedure) then raise exception 'PRIVILEGES_CHANGED'; end if;
end$$;
create function pg_temp.review_input(batch text,session text,snapshot text) returns jsonb language sql as $$
 select jsonb_build_object('session_id',session,'snapshot',jsonb_build_object(
  'snapshot_id',snapshot,'snapshot_sha256',repeat('a',64),'batch_id',batch,'quality_status','PERLU_KLARIFIKASI',
  'payload_json',jsonb_build_object('snapshot_id',snapshot,'snapshot_sha256',repeat('a',64),'records',jsonb_build_array(jsonb_build_object('report_id','R001','total_people',0,'male',null)))::text,
  'created_at',now(),'expires_at',now()+interval '1 day','version',1,'superseded_by',null));
$$;
insert into public.sigap_entities(kind,id,document) values
 ('batches','review-batch','{"batch_id":"review-batch","session_id":"mine","request_id":"mine:review","status":"processing"}'),
 ('batches','review-other','{"batch_id":"review-other","session_id":"other","request_id":"other:review","status":"processing"}');
do $$declare input jsonb; result jsonb; original jsonb; saved_batch jsonb; candidate jsonb; status text; bad jsonb;
begin
 input:=pg_temp.review_input('review-batch','mine',repeat('1',32));
 result:=public.sigap_dispatch('review.prepare',input); original:=result->'snapshot';
 if result->'created'<>'true'::jsonb or original->'version'<>'1'::jsonb then raise exception 'CREATE_WRONG'; end if;
 select document into saved_batch from public.sigap_entities where kind='batches' and id='review-batch';
 if saved_batch->>'status'<>'ready_for_review' or saved_batch->>'latest_snapshot_id'<>repeat('1',32)
  or saved_batch->>'preview_payload_json' is distinct from original->>'payload_json' then raise exception 'PREVIEW_WRONG'; end if;
 input:=jsonb_set(input,'{snapshot,payload_json}',to_jsonb(jsonb_set((input->'snapshot'->>'payload_json')::jsonb,'{records,0,total_people}','999')::text));
 result:=public.sigap_dispatch('review.prepare',input);
 if result->'created'<>'false'::jsonb or result->'snapshot' is distinct from original or saved_batch is distinct from
  (select document from public.sigap_entities where kind='batches' and id='review-batch') then raise exception 'REPLAY_OVERWROTE_DATA'; end if;
 result:=public.sigap_dispatch('review.prepare',pg_temp.review_input('review-other','other',repeat('1',32)));
 if result->'created'<>'false'::jsonb or result->'snapshot' is distinct from original then raise exception 'REFERENCE_OVERWRITTEN'; end if;
 if (select document->>'status' from public.sigap_entities where id='review-other')<>'processing' then raise exception 'FOREIGN_BATCH_CHANGED'; end if;
 result:=public.sigap_dispatch('review.prepare',pg_temp.review_input('review-batch','mine',repeat('2',32)));
 if result->'snapshot'->'version'<>'2'::jsonb then raise exception 'VERSION_WRONG'; end if;
 for status in select unnest(array['saving','verifying','done','failed','payload_invalid']) loop
  update public.sigap_entities set document=document||jsonb_build_object('status',status) where kind='batches' and id='review-batch';
  begin
   perform public.sigap_dispatch('review.prepare',pg_temp.review_input('review-batch','mine',repeat('3',32)));
   raise exception 'EXPECTED_BATCH_REJECTION';
  exception when others then if sqlerrm<>'REVIEW_BATCH_NOT_EDITABLE' then raise; end if; end;
 end loop;
 update public.sigap_entities set document=document||'{"status":"ready_for_review"}'::jsonb where kind='batches' and id='review-batch';
 begin
  perform public.sigap_dispatch('review.prepare',pg_temp.review_input('review-batch','foreign',repeat('3',32)));
  raise exception 'EXPECTED_SCOPE_REJECTION';
 exception when others then if sqlerrm<>'REVIEW_BATCH_NOT_EDITABLE' then raise; end if; end;
 input:=pg_temp.review_input('review-batch','mine',repeat('3',32));
 for bad in select v from jsonb_array_elements(jsonb_build_array(null,'{}'::jsonb,
  jsonb_set(input,'{snapshot,snapshot_sha256}','"invalid"'),
  jsonb_set(input,'{snapshot,superseded_by}','"changed"'),
  jsonb_set(input,'{snapshot,payload_json}','"{}"'),
  jsonb_set(input,'{snapshot,expires_at}',to_jsonb((now()-interval '1 hour')::text)))) v loop
  begin
   perform public.sigap_dispatch('review.prepare',bad);raise exception 'EXPECTED_INPUT_REJECTION';
  exception when others then if sqlerrm<>'REVIEW_INPUT_INVALID' then raise; end if; end;
 end loop;
 if exists(select 1 from public.sigap_entities where kind='snapshots' and id=repeat('3',32)) then raise exception 'REJECTED_SNAPSHOT_CREATED'; end if;
end$$;
create function pg_temp.fail_review_batch() returns trigger language plpgsql as $$begin
 if new.kind='batches' and new.id='review-other' then raise exception 'FIXTURE_BATCH_WRITE_FAILED'; end if;return new;
end$$;
create trigger fail_review before update on public.sigap_entities for each row execute function pg_temp.fail_review_batch();
do $$declare original jsonb;begin
 select document into original from public.sigap_entities where kind='batches' and id='review-other';
 begin
  perform public.sigap_dispatch('review.prepare',pg_temp.review_input('review-other','other',repeat('4',32)));
  raise exception 'EXPECTED_WRITE_FAILURE';
 exception when others then if sqlerrm<>'FIXTURE_BATCH_WRITE_FAILED' then raise; end if; end;
 if exists(select 1 from public.sigap_entities where kind='snapshots' and id=repeat('4',32)) or original is distinct from
  (select document from public.sigap_entities where kind='batches' and id='review-other') then raise exception 'ATOMIC_ROLLBACK_FAILED'; end if;
end$$;
rollback;
\echo Review preparation fixture passed.
