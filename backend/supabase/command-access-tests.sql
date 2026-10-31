-- Disposable PostgreSQL only: all fixture Auth users are rolled back.
begin;
insert into public.sigap_organizations(id,name) values
 ('11111111-1111-4111-8111-111111111111','Command A'),
 ('22222222-2222-4222-8222-222222222222','Command B');
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000001','admin-a@example.test',now()),
 ('10000000-0000-4000-8000-000000000002','admin-b@example.test',now()),
 ('10000000-0000-4000-8000-000000000003','officer@example.test',now()),
 ('10000000-0000-4000-8000-000000000004','invitee@example.test',now()),
 ('10000000-0000-4000-8000-000000000005','unverified@example.test',null),
 ('10000000-0000-4000-8000-000000000006','outsider@example.test',now()),
 ('10000000-0000-4000-8000-000000000007','revoked@example.test',now()),
 ('10000000-0000-4000-8000-000000000008','expired@example.test',now());
insert into public.sigap_memberships(user_id,organization_id,role,status) values
 ('10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','admin','active'),
 ('10000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','admin','active');
insert into public.sigap_memberships(user_id) select id from auth.users where id in (
 '10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004',
 '10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006',
 '10000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000008');
set local role service_role;
do $$declare
 admin_a constant text := '10000000-0000-4000-8000-000000000001';
 admin_b constant text := '10000000-0000-4000-8000-000000000002';
 officer constant text := '10000000-0000-4000-8000-000000000003';
 invitee constant text := '10000000-0000-4000-8000-000000000004';
 org_a constant text := '11111111-1111-4111-8111-111111111111';
 org_b constant text := '22222222-2222-4222-8222-222222222222';
 r jsonb; invitation jsonb; request_id text;
begin
 perform public.sigap_dispatch('admin.operation.create',jsonb_build_object('actor_id',admin_a,'context_id','flood','name','Flood A','description','Regional operation'));
 perform public.sigap_dispatch('admin.operation.create',jsonb_build_object('actor_id',admin_b,'context_id','flood','name','Flood B'));
 perform public.sigap_dispatch('admin.operation.update',jsonb_build_object('actor_id',admin_a,'context_id','flood','name','Updated A'));
 if public.sigap_dispatch('context.get',jsonb_build_object('actor_id',admin_b,'context_id','flood'))->>'name'<>'Flood B' then raise exception 'cross-command operation update'; end if;
 if jsonb_array_length(public.sigap_dispatch('admin.users',jsonb_build_object('actor_id',admin_a)))<>1 then raise exception 'pending or foreign members leaked'; end if;
 begin perform public.sigap_dispatch('admin.update',jsonb_build_object('actor_id',admin_a,'user_id',officer,'role','admin','status','active','scopes','[]'::jsonb));raise exception 'global pending account claimed'; exception when raise_exception then if sqlerrm<>'USER_NOT_FOUND' then raise;end if;end;
 begin perform public.sigap_dispatch('membership.request',jsonb_build_object('actor_id','10000000-0000-4000-8000-000000000005','organization_id',org_a));raise exception 'unverified joined';exception when insufficient_privilege then null;end;
 r=public.sigap_dispatch('membership.request',jsonb_build_object('actor_id',officer,'organization_id',org_a,'note','Volunteer'));request_id=r->>'id';
 if jsonb_array_length(public.sigap_dispatch('admin.requests',jsonb_build_object('actor_id',admin_a)))<>1 or jsonb_array_length(public.sigap_dispatch('admin.requests',jsonb_build_object('actor_id',admin_b)))<>0 then raise exception 'applicant listing leaked'; end if;
 begin perform public.sigap_dispatch('admin.request.decide',jsonb_build_object('actor_id',admin_b,'request_id',request_id,'decision','approve','role','admin','scopes','[]'::jsonb));raise exception 'foreign admin approved';exception when insufficient_privilege then null;end;
 begin perform public.sigap_dispatch('admin.request.decide',jsonb_build_object('actor_id',admin_a,'request_id',request_id,'decision','approve','role','petugas','scopes','["unknown"]'::jsonb));raise exception 'invalid scope assigned';exception when insufficient_privilege then null;end;
 perform public.sigap_dispatch('admin.request.decide',jsonb_build_object('actor_id',admin_a,'request_id',request_id,'decision','approve','role','petugas','scopes','["flood"]'::jsonb));
 if public.sigap_dispatch('scope.check',jsonb_build_object('actor_id',officer,'context_id','flood'))->>'organization_id'<>org_a then raise exception 'wrong command assigned'; end if;
 begin perform public.sigap_dispatch('membership.request',jsonb_build_object('actor_id',officer,'organization_id',org_b));raise exception 'member changed command';exception when insufficient_privilege then null;end;
 begin perform public.sigap_dispatch('admin.request.decide',jsonb_build_object('actor_id',admin_a,'request_id',request_id,'decision','approve','role','admin','scopes','[]'::jsonb));raise exception 'approval replay';exception when insufficient_privilege then null;end;
 begin perform public.sigap_dispatch('admin.operation.create',jsonb_build_object('actor_id',officer,'context_id','evil','name','Bad'));raise exception 'officer created operation';exception when insufficient_privilege then null;end;

 invitation=public.sigap_dispatch('admin.invitation.create',jsonb_build_object('actor_id',admin_a,'email','invitee@example.test','role','viewer','scopes','[]'::jsonb,'token_hash',repeat('a',64),'expires_at',now()+interval '1 day'));
 if invitation?'token_hash' or public.sigap_dispatch('admin.invitations',jsonb_build_object('actor_id',admin_a))->0?'token_hash' then raise exception 'token hash leaked'; end if;
 if jsonb_array_length(public.sigap_dispatch('admin.invitations',jsonb_build_object('actor_id',admin_b)))<>0 then raise exception 'foreign invitation leaked'; end if;
 begin perform public.sigap_dispatch('membership.accept',jsonb_build_object('actor_id','10000000-0000-4000-8000-000000000006','organization_id',org_a,'token_hash',repeat('a',64)));raise exception 'email mismatch accepted';exception when insufficient_privilege then null;end;
 begin perform public.sigap_dispatch('membership.accept',jsonb_build_object('actor_id',invitee,'organization_id',org_b,'token_hash',repeat('a',64)));raise exception 'wrong command accepted';exception when insufficient_privilege then null;end;
 r=public.sigap_dispatch('membership.accept',jsonb_build_object('actor_id',invitee,'organization_id',org_a,'token_hash',repeat('a',64)));
 if r->>'role'<>'viewer' or r->>'organization_id'<>org_a then raise exception 'invitation grant wrong'; end if;
 begin perform public.sigap_dispatch('membership.accept',jsonb_build_object('actor_id',invitee,'organization_id',org_a,'token_hash',repeat('a',64)));raise exception 'invite replay';exception when insufficient_privilege then null;end;
 begin perform public.sigap_dispatch('scope.check',jsonb_build_object('actor_id',invitee,'context_id','flood'));raise exception 'viewer raw data';exception when insufficient_privilege then null;end;
 invitation=public.sigap_dispatch('admin.invitation.create',jsonb_build_object('actor_id',admin_a,'email','revoked@example.test','role','petugas','scopes','["flood"]'::jsonb,'token_hash',repeat('b',64),'expires_at',now()+interval '1 day'));
 begin perform public.sigap_dispatch('admin.invitation.revoke',jsonb_build_object('actor_id',admin_b,'invitation_id',invitation->>'id'));raise exception 'foreign invitation revoked';exception when insufficient_privilege then null;end;
 perform public.sigap_dispatch('admin.invitation.revoke',jsonb_build_object('actor_id',admin_a,'invitation_id',invitation->>'id'));
 begin perform public.sigap_dispatch('membership.accept',jsonb_build_object('actor_id','10000000-0000-4000-8000-000000000007','organization_id',org_a,'token_hash',repeat('b',64)));raise exception 'revoked invite accepted';exception when insufficient_privilege then null;end;
 invitation=public.sigap_dispatch('admin.invitation.create',jsonb_build_object('actor_id',admin_a,'email','expired@example.test','role','admin','scopes','[]'::jsonb,'token_hash',repeat('c',64),'expires_at',now()+interval '1 day'));
 update public.sigap_invitations set expires_at=now()-interval '1 second' where id=(invitation->>'id')::uuid;
 begin perform public.sigap_dispatch('membership.accept',jsonb_build_object('actor_id','10000000-0000-4000-8000-000000000008','organization_id',org_a,'token_hash',repeat('c',64)));raise exception 'expired invite accepted';exception when insufficient_privilege then null;end;
 if exists(select 1 from public.sigap_entities where kind='audit_log' and (document ? 'token_hash' or document ? 'token')) then raise exception 'audit secret leaked'; end if;
end $$;
reset role;
set local role authenticated;
do $$begin
 begin perform * from public.sigap_invitations;raise exception 'invites directly readable';exception when insufficient_privilege then null;end;
 begin perform * from public.sigap_join_requests;raise exception 'requests directly readable';exception when insufficient_privilege then null;end;
 begin perform public.sigap_command_dispatch('admin.command.get','{}');raise exception 'command RPC callable';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: command separation, verified onboarding, scoped roles, invitation replay/expiry/revocation, RLS and audit' as result;
