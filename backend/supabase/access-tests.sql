\set ON_ERROR_STOP on
begin;
insert into public.sigap_organizations(id,name) values('11111111-1111-4111-8111-111111111111','Fixture');
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000001','admin@example.test',now()),
 ('10000000-0000-4000-8000-000000000002','officer@example.test',now()),
 ('10000000-0000-4000-8000-000000000003','viewer@example.test',now()),
 ('10000000-0000-4000-8000-000000000004','pending@example.test',now());
insert into public.sigap_memberships(user_id,organization_id,role,status,scopes) values
 ('10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','admin','active','{}'),
 ('10000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','petugas','active','{posko-a}'),
 ('10000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','viewer','active','{}');
insert into public.sigap_contexts(organization_id,context_id,name) values('11111111-1111-4111-8111-111111111111','posko-a','A'),('11111111-1111-4111-8111-111111111111','posko-b','B');
set local role service_role;
do $$begin
 if (public.sigap_dispatch('scope.check','{"actor_id":"10000000-0000-4000-8000-000000000002","context_id":"posko-a"}')->>'role')<>'petugas' then raise exception 'wrong role'; end if;
 begin perform public.sigap_dispatch('scope.check','{"actor_id":"10000000-0000-4000-8000-000000000002","context_id":"posko-b"}');raise exception 'scope allowed';exception when insufficient_privilege then null;end;
 begin perform public.sigap_dispatch('scope.check','{"actor_id":"10000000-0000-4000-8000-000000000003","context_id":"posko-a"}');raise exception 'viewer allowed';exception when insufficient_privilege then null;end;
 perform public.sigap_dispatch('profile.ensure','{"user_id":"10000000-0000-4000-8000-000000000004","display_name":"Pending"}');
 begin perform public.sigap_dispatch('scope.check','{"actor_id":"10000000-0000-4000-8000-000000000004","context_id":"posko-a"}');raise exception 'pending allowed';exception when insufficient_privilege then null;end;
 perform public.sigap_dispatch('storage.commit','{"actor_id":"10000000-0000-4000-8000-000000000002","context_id":"posko-a","revision":0,"commit_key":"first","request_hash":"hash","document":{"header":["posko"],"rows":[["A"]]},"result":{"saved":true}}');
 if public.sigap_dispatch('storage.commit','{"actor_id":"10000000-0000-4000-8000-000000000002","context_id":"posko-a","revision":0,"commit_key":"first","request_hash":"hash","result":{}}')->>'replayed'<>'true' then raise exception 'idempotency failed';end if;
 begin perform public.sigap_dispatch('storage.commit','{"actor_id":"10000000-0000-4000-8000-000000000002","context_id":"posko-a","revision":0,"commit_key":"second","request_hash":"hash","document":{},"result":{}}');raise exception 'CAS allowed';exception when raise_exception then if sqlerrm<>'STALE_STORAGE' then raise;end if;end;
 perform public.sigap_dispatch('membership.request','{"actor_id":"10000000-0000-4000-8000-000000000004","organization_id":"11111111-1111-4111-8111-111111111111"}');
 perform public.sigap_dispatch('admin.request.decide',jsonb_build_object('actor_id','10000000-0000-4000-8000-000000000001','request_id',(select id from public.sigap_join_requests where user_id='10000000-0000-4000-8000-000000000004'),'decision','approve','role','viewer','scopes','[]'::jsonb));
end $$;
reset role;
insert into public.sigap_publications(organization_id,context_id,content,content_sha256,approved_by) values('11111111-1111-4111-8111-111111111111','posko-a','Summary','hash','10000000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000003';
do $$begin
 if (select count(*) from public.sigap_memberships)<>1 then raise exception 'profile leak';end if;
 if (select count(*) from public.sigap_publications)<>1 then raise exception 'publication hidden';end if;
 begin perform public.sigap_dispatch('entity.list','{"kind":"sessions"}');raise exception 'RPC allowed';exception when insufficient_privilege then null;end;
 begin perform * from public.sigap_storage;raise exception 'raw storage allowed';exception when insufficient_privilege then null;end;
 begin update public.sigap_memberships set role='admin' where user_id=auth.uid();raise exception 'self promotion allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role anon;
do $$begin
 begin perform * from public.sigap_publications;raise exception 'anon allowed';exception when insufficient_privilege then null;end;
 begin perform public.sigap_gateway_secret();raise exception 'secret allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'SIGAP role, scope, RLS, CAS and idempotency checks passed' as result;
