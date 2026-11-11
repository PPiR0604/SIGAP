-- Additive, read-only recovery through the existing authenticated storage scope.
do $migration$
declare definition text; anchor text := $anchor$ elsif p_action='storage.read' then$anchor$;
 addition text := $addition$
  -- sigap:workspace-recovery-v1: cursor, drafts and storage share one SQL snapshot.
  if p_args ? 'recovery_session_id' then
   if jsonb_typeof(p_args->'recovery_session_id') is distinct from 'string'
      or length(p_args->>'recovery_session_id')=0
      or jsonb_typeof(p_args->'workspace_cutoff') is distinct from 'string'
      or (p_args->>'workspace_cutoff') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      then raise exception 'RECOVERY_OPTIONS_INVALID'; end if;
   perform (p_args->>'workspace_cutoff')::timestamptz;
   select jsonb_build_object(
    'revision',coalesce(storage.revision,0),
    'document',coalesce(storage.document,'{"header":[],"rows":[]}'::jsonb),
    'recovery',jsonb_build_object('session_id',workspace.id,
     'after_event_id',coalesce((select event.document->'event_id' from public.sigap_entities event
       where event.kind='events' and event.document->>'session_id'=workspace.id
       order by (event.document->>'event_id')::bigint desc limit 1),'0'::jsonb),
     'state',jsonb_build_object(
      'reviews',(select coalesce(jsonb_agg(jsonb_build_object('snapshot',snapshot.document,'batch',batch.document)
        order by batch.seq desc,snapshot.seq desc),'[]'::jsonb)
       from public.sigap_entities batch join public.sigap_entities snapshot
        on snapshot.kind='snapshots' and snapshot.document @> jsonb_build_object('batch_id',batch.id,'superseded_by',null)
       where batch.kind='batches' and batch.document @> jsonb_build_object('session_id',workspace.id,'status','ready_for_review')
        and (snapshot.document->>'expires_at') collate "C" > (p_args->>'workspace_cutoff') collate "C"),
      'activeBatch',(select document from public.sigap_entities where kind='batches'
        and document @> jsonb_build_object('session_id',workspace.id)
        and document->>'status' in ('processing','saving','verifying') order by seq desc limit 1))))
    into r from public.sigap_entities workspace left join public.sigap_storage storage
     on storage.organization_id=org and storage.context_id=ctx
    where workspace.kind='sessions' and workspace.id=p_args->>'recovery_session_id'
     and workspace.document @> jsonb_build_object('session_id',workspace.id,'organization_id',org::text,'context_id',ctx)
     and (m.role='admin' or workspace.document->>'owner_user_id'=actor::text);
   if r is null then raise exception 'RECOVERY_SESSION_DENIED' using errcode='42501'; end if;
   return r;
  end if;
$addition$;
begin
 perform set_config('lock_timeout','3s',true);
 definition := replace(pg_get_functiondef('public.sigap_dispatch(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 if strpos(definition,'sigap:workspace-recovery-v1')=0 then
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
   raise exception 'UNEXPECTED_DISPATCH_DEFINITION'; end if;
  execute replace(definition,anchor,anchor||addition);
 end if;
end
$migration$;
