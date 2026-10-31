# Backend authentication and migration

The frontend is integrated with Supabase Auth. Some migration and verification notes below describe the historical cutover, not the current UI or proof of a current live deployment. See [README.md](README.md) for the current overview.

Production startup requires `SIGAP_SUPABASE_URL`, `SIGAP_SUPABASE_PUBLISHABLE_KEY`, `SIGAP_SUPABASE_GATEWAY_SECRET` (at least 48 random characters), and `SIGAP_ORGANIZATION_ID`. Missing configuration fails closed. The SQLite repository and shared-token route are available only when a repository is explicitly injected by tests, not through an environment switch.

Command membership and operation workspaces are implemented in [COMMAND_WORKSPACES.md](COMMAND_WORKSPACES.md): one configured command with multiple admins, verified email invitations, admin-reviewed join requests, and assigned operation spaces. Registering does not create a command or grant an admin role. Admins can no longer list or claim unrelated pending users.

## Roles

| Role | Access |
|---|---|
| admin | All operational contexts in its organization, user activation/roles/assignments, audit and approval of bulletin content |
| petugas | Its own sessions in assigned contexts, reports/imports, analysis, corrections and explicit save/clear approval |
| viewer | Approved bulletin content in its organization, no raw reports, chat, model calls, draft or operational writes |

An operational context is a named posko workspace. A context may contain several physical shelters when they are managed together. Assignment is to the complete workspace dataset, not an arbitrary field inside a mixed report. Use separate contexts for separately authorized shelter datasets. Sessions remain private to their creator except for organization admins. An unassigned user cannot inspect another context by guessing a UUID or a snapshot hash.

Registration can provision an isolated petugas training workspace when configured, or return pending access requiring an admin. Passwords require at least 8 characters. The current no-confirmation signup flow requires Confirm email to be disabled in Supabase; login remains email/password. Role/status and scope are read from `sigap_memberships` on every request and tool call, never from user metadata. JWT identity is checked using the project's Auth `/user` endpoint. Sensitive operations also check the underlying Auth session, expiry and local session revocation. Existing SSE streams recheck authorization every 15 seconds and close on expiry/revocation.

## API

All JSON errors use `{error:{code}}`. Operational endpoints require `Authorization: Bearer <Supabase access_token>`. Auth responses carry access/refresh tokens and `Cache-Control: no-store`. The integrated frontend handles sessions and refresh.

| Method | Path | Permission |
|---|---|---|
| POST | `/api/auth/register` | Public, `{email,password,display_name}`; 8–128 character password, unknown fields rejected |
| POST | `/api/auth/login` | Public, `{email,password}` |
| POST | `/api/auth/refresh` | Public, `{refresh_token}` |
| POST | `/api/auth/password/reset` | Public, `{email}`; configure Auth recovery URL separately |
| GET | `/api/auth/me` | Logged in, including pending |
| POST | `/api/auth/logout` | Logged in; revokes current session locally before provider logout |
| POST | `/api/auth/password` | Logged in, `{password}`; accepts the session resulting from recovery |
| GET | `/api/contexts` | Active admin/petugas, assigned contexts |
| GET | `/api/publications` | Active account, approved content only |
| GET/PATCH | `/api/admin/users[/:id]` | Admin; PATCH `{role,status,scopes}`; no self-changing privileges |
| POST | `/api/admin/contexts` | Admin, `{context_id,name}` |
| GET | `/api/admin/audit` | Admin, organization-scoped metadata |
| POST | `/api/batches/:id/publication` | Admin, `{content_sha256}` matching stored preview; stores an internal approval, does not send email or create Google Docs |

The existing sessions/messages/events/batches/decisions APIs remain, with authentication and resource scope checks. `actor_id` for human approval is taken from the verified user. AI flags such as `confirmed_by_officer` never establish user identity or role. Save approval remains bound to the exact snapshot, conflict choices and clear decisions, and is consumed once. Publication approval never grants a tool permission to publish externally.

## Database and trust boundary

`supabase/schema.sql` creates memberships, organizations, contexts, operational metadata, canonical storage/history, flow snapshots and approved publications. JSONB metadata preserves existing contracts and data types. Canonical row merges reuse the reviewed SQLite merge algorithm in disposable scratch space, then commit through a Postgres compare-and-swap transaction. Supabase stores the authoritative state, receipt and full before/after history. Version conflicts fail without automatic retry or fallback to SQLite/Sheets.

All tables enable RLS. Authenticated clients can read only their own membership and approved publications allowed by policy. They receive no direct operational table or RPC write grants. Invoker RPCs are executable only by `service_role`; user-facing mutations go through the backend's authorization checks and human approval gate.

The `sigap-backend` Edge Function uses custom HMAC authentication, so its platform JWT check is disabled. This does **not** make its database API anonymous: it validates an exact-body HMAC, a 60-second time window and a one-use nonce before dispatch. Its service-role credential stays in Edge runtime. The random gateway secret stays in the private database schema and backend environment, never in frontend code, LLM messages or exported flow files. Deploying this function and schema requires confirmation of the target project.

Backend MCP dispatch injects a short-lived signed capability on a separate secure input connection to each custom Langflow component. Models receive normal schemas, source text and results, not capabilities. Each database operation checks current session/membership/assignment. Flow snapshot lookups are scoped to the organization/context. Unsigned MCP calls to secure flows fail. The Bob ACP adapter is fail-closed in Auth mode until it supports this secure transport; Gemini/OpenAI-compatible runtime supports it.

## Deployment sequence

1. Confirm the exact Supabase project. Inspect its tables and advisors. Apply `supabase/schema.sql` with the connector's migration tool. Never run `test-bootstrap.sql` against Supabase.
2. Create the organization and generate a cryptographically random gateway secret. Insert it into `sigap_private.gateway_secret`, and set the matching value in the backend `.env`. Never print or commit it. Obtain the project's publishable key.
3. Deploy `supabase/gateway.ts` as `sigap-backend`, with custom HMAC authentication. Verify correct signatures work and invalid/replayed requests fail.
4. During a maintenance window, stop new operational writes and make consistent SQLite backup copies (including committed WAL data). Preserve both sources and all flow rollback exports. Do not copy only a hot database's `.db` file.
5. Prepare the importer against backups:

```powershell
node --import tsx scripts/migrate-supabase.ts --metadata=METADATA_BACKUP.db --shelters=SHELTERS_BACKUP.sqlite3 --organization=ORG_UUID --context=posko-default --snapshots=OLD_SNAPSHOT_DIR
```

Inspect the private manifest in `output/auth-migration/`. Add `--apply` only for the confirmed target. Import is one transaction into an empty target, is idempotent by the manifest hash, compares full imported records and canonical rows on read-back, and preserves legacy history/receipts. Pending historical approvals are revoked, interrupted operations require review, and old sessions have no invented owner. Old flow snapshots are archived, not made executable under a new identity.

6. Run `python langflow/scripts/build_supabase_flows.py`. From `backend`, inspect `node --import tsx scripts/deploy-supabase-flows.ts`, then apply with `--apply`. All seven flows retain their IDs, existing graph configuration and model credentials. Stop writers while upgrading. Set `SIGAP_BACKEND_INTERNAL_URL` on the Langflow process to the authenticated backend's reachable URL. The default is `http://127.0.0.1:8787` for local Langflow reaching a backend Docker published port.
7. Start the backend with Supabase settings. Set `SIGAP_BOOTSTRAP_ADMIN_EMAIL` to the specifically approved admin email. Register and verify that email, then log in: the first verified login bootstraps this one account, provided no active admin exists. Role/email values in user metadata have no effect. Remove this installer allowlist after setup. Alternatively run the local administrative command once after verification:

```powershell
node --import tsx scripts/bootstrap-admin.ts --email=VERIFIED_ADMIN_EMAIL
```

The bootstrap requires a verified user and refuses when an active admin already exists. Subsequent role changes go through the authenticated admin API. Verify register/login, pending denial, scopes, save/read-back, publication approval and viewer read end-to-end before switching clients. Verify the integrated frontend against the target deployment.

## Checks and rollback

Deployment on 25 October 2026: project `tdhbhasewgdhczcwogqq`, organization `1ae7ade9-7178-427f-ac06-6713f9458742`. Imported 183 sessions, 193 batches, 1,349 events, 73 metadata snapshots, 17 approvals, 34 audit entries and 9 shelters, plus 15 legacy shelter-history entries and 7 legacy storage receipts. Full JSONB entity equality and canonical-row equality passed after import. Original SQLite files and final consistent backups remain available. Historical flow snapshot files remain local; new secure flows store snapshots in Supabase and do not execute old references.

Verification: 158 backend tests, 17 Python integration tests, TypeScript build, hosted SQL role/RLS/CAS/idempotency checks passed. Production dependency audit and Supabase security advisors returned no findings. The live HMAC gateway rejected replay and tampered-body requests. All seven MCP tools were discovered and the actual Langflow reader rejected unsigned input. Docker backend is healthy, exposes no local session token, rejects unauthenticated operational requests with 401, and reaches the local Langflow runtime. Real user signup/email verification/password login and a fully authenticated write/read-back through Langflow still require the initial verified user account. No persistent synthetic Auth users were installed in the project.

Run `npm run build`, `npm test`, Python integration tests, and `supabase/access-tests.sql` against a disposable test database. The local test fixture supplies stub Auth schema and roles for PostgreSQL; it does not prove hosted email delivery or provider configuration. Run Supabase security advisors after deployment.

Keep original databases, consistent backups, import manifest and flow rollback copies private. Do not roll back to an older SQLite backup after new cloud writes without exporting and reconciling those writes. No cloud cutover or database deletion is automatic.
