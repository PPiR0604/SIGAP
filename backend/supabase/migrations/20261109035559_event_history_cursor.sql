-- Additive service-only history optimization. No entity/storage rows are modified.
-- Replace only the known list branch; preserve all other live dispatch actions.
do $migration$
declare definition text; prior_branch text := $prior$ elsif p_action='entity.list' then
  return (select coalesce(jsonb_agg(document order by seq),'[]') from public.sigap_entities where kind=p_args->>'kind' and document @> coalesce(p_args->'filter','{}'));$prior$;
 new_branch text := $next$ elsif p_action='entity.list' then
  -- sigap:event-history-cursor-v1: bound queries to one exact session.
  if p_args->>'kind'='events' and
     (p_args->'latest_event_id'='true'::jsonb or p_args ? 'after_event_id') then
   if jsonb_typeof(p_args->'filter'->'session_id') is distinct from 'string'
      or length(p_args->'filter'->>'session_id')=0 then raise exception 'EVENT_SESSION_REQUIRED'; end if;
   if p_args->'latest_event_id'='true'::jsonb then
    return coalesce((select document->'event_id' from public.sigap_entities
     where kind='events' and document->>'session_id'=p_args->'filter'->>'session_id'
      and document @> (p_args->'filter')
     order by (document->>'event_id')::bigint desc limit 1),'0'::jsonb);
   end if;
   if jsonb_typeof(p_args->'after_event_id') is distinct from 'number'
      or (p_args->>'after_event_id')::numeric<0
      or (p_args->>'after_event_id')::numeric>9007199254740991
      or trunc((p_args->>'after_event_id')::numeric)<>(p_args->>'after_event_id')::numeric
      then raise exception 'EVENT_CURSOR_INVALID'; end if;
   return (select coalesce(jsonb_agg(document order by (document->>'event_id')::bigint),'[]') from public.sigap_entities
    where kind='events' and document->>'session_id'=p_args->'filter'->>'session_id'
     and document @> (p_args->'filter') and (document->>'event_id')::bigint>(p_args->>'after_event_id')::bigint);
  end if;
  return (select coalesce(jsonb_agg(document order by seq),'[]') from public.sigap_entities where kind=p_args->>'kind' and document @> coalesce(p_args->'filter','{}'));$next$;
begin
 perform set_config('lock_timeout','3s',true);
 definition := replace(pg_get_functiondef('public.sigap_dispatch(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 if strpos(definition,'sigap:event-history-cursor-v1')=0 then
  if (length(definition)-length(replace(definition,prior_branch,'')))/length(prior_branch)<>1
   then raise exception 'UNEXPECTED_DISPATCH_DEFINITION'; end if;
  execute replace(definition,prior_branch,new_branch);
 end if;
 execute 'create index if not exists sigap_events_session_cursor on public.sigap_entities
  ((document->>''session_id''),((document->>''event_id'')::bigint) desc) where kind=''events''';
end
$migration$;
