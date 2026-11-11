-- One session-scoped, read-only workspace summary. Existing callers remain compatible.
do $migration$
declare definition text; anchor text := $anchor$ elsif p_action='entity.list' then$anchor$;
 addition text := $addition$  -- sigap:workspace-state-v1: return only current review rows and active work.
  if p_args->>'kind'='batches' and p_args->'workspace_state'='true'::jsonb then
   if jsonb_typeof(p_args->'filter'->'session_id') is distinct from 'string'
      or length(p_args->'filter'->>'session_id')=0
      or p_args->'filter' is distinct from jsonb_build_object('session_id',p_args->'filter'->>'session_id')
      then raise exception 'WORKSPACE_SESSION_REQUIRED'; end if;
   if jsonb_typeof(p_args->'workspace_cutoff') is distinct from 'string'
      or (p_args->>'workspace_cutoff') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      or (p_args ? 'active_only' and jsonb_typeof(p_args->'active_only') is distinct from 'boolean')
      then raise exception 'WORKSPACE_OPTIONS_INVALID'; end if;
   perform (p_args->>'workspace_cutoff')::timestamptz;
   return jsonb_build_object(
    'reviews',case when p_args->'active_only'='true'::jsonb then '[]'::jsonb else
     (select coalesce(jsonb_agg(jsonb_build_object('snapshot',snapshot.document,'batch',batch.document)
       order by batch.seq desc,snapshot.seq desc),'[]'::jsonb)
      from public.sigap_entities batch join public.sigap_entities snapshot
       on snapshot.kind='snapshots' and snapshot.document @> jsonb_build_object('batch_id',batch.id,'superseded_by',null)
      where batch.kind='batches' and batch.document @> ((p_args->'filter')||'{"status":"ready_for_review"}'::jsonb)
       and (snapshot.document->>'expires_at') collate "C" > (p_args->>'workspace_cutoff') collate "C") end,
    'activeBatch',(select document from public.sigap_entities where kind='batches' and document @> (p_args->'filter')
      and document->>'status' in ('processing','saving','verifying') order by seq desc limit 1));
  end if;
$addition$;
begin
 perform set_config('lock_timeout','3s',true);
 definition := replace(pg_get_functiondef('public.sigap_dispatch(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 if strpos(definition,'sigap:workspace-state-v1')=0 then
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
   raise exception 'UNEXPECTED_DISPATCH_DEFINITION'; end if;
  execute replace(definition,anchor,anchor||addition);
 end if;
end
$migration$;
