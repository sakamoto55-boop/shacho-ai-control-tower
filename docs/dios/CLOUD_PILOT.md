# DIOS cloud owner-pilot

Status: implementation under validation, NOT a live deployment or an approval to incur cloud costs.

## What remains the same
The TypeScript COMMAND business services, deterministic engines, MemoryService learning safety and RBAC remain the implementation baseline. The new server injects PostgreSQL storage, server-side Google sessions and durable conversation context. It never imports the legacy file-backed `src/server.ts`.

## Pilot boundary
One deployment and one runtime database role per tenant. Initially only a pre-enrolled PRESIDENT may sign in. This is not employee/customer SaaS release readiness. Legacy file-backed intelligence, pairing, generated-file rendering and not-yet-migrated endpoints return `CLOUD_MODULE_PENDING`; they are not silently redirected to local files. Bank transfers and automatic external sends remain disabled. Provider/Sheets configuration is independent of ChatGPT plugin authorization. Google login requests only openid/email, not Gmail access.

## Storage/security
- PostgreSQL row-level policies also require an operator-managed tenant-to-database-role binding. Changing a tenant session variable does not expose another tenant.
- Runtime role cannot own tables, bypass RLS, be superuser, or create roles. User enrolment and role changes require the migration operator.
- One transaction covers business records and conversation history. Midway failures roll back all record/revision changes.
- Revisions and audit are append-only to the runtime role. This is not WORM protection against database administrators.
- Runtime-generated IDs include random UUIDs so restarts do not overwrite records.
- Google RS256 signature, issuer, audience, expiry, nonce, verified email, PKCE and one-use browser-bound state are validated.
- Session tokens are stored hashed. Secure/HttpOnly host-only cookies, same-origin write checks, per-member rate limiting and active-member checks protect browser access. Revoking sessions or disabling a member invalidates access.
- UI has no URL-provided API origin or bearer token. A fixed owner conversation can be resumed on another authenticated device.
- Existing sensitive-content checks redact certain personal/financial secrets from conversation-history copies. They are not comprehensive DLP: restricted data must not be enabled until retention and classification are accepted.

## Operator setup order
1. Obtain approval for the target cloud project, region, managed database cost, backup/retention and public HTTPS origin. Do not assume a previous relay authorization also covers this application.
2. Create a private managed PostgreSQL instance; use a migration operator distinct from the runtime login.
3. Build (`npm ci --ignore-scripts && npm run build`). Run `scripts/dios/migrate.mjs` only with `DIOS_MIGRATION_APPROVED=yes`, the migration operator's database configuration, and no secrets in logs or source control.
4. Create a non-owner `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE` role using the operator's secure credential process. Apply `scripts/dios/runtime-grants.sql` with psql variables `runtime_role` and `tenant_id`.
5. Run `scripts/dios/enroll-owner.mjs` with the migration operator's configuration, `DIOS_OWNER_ENROLL_APPROVED=yes`, exact owner email and JSON `DIOS_OWNER_COMPANIES`. It inserts only; it does not overwrite existing accounts.
6. Register a Google Web OAuth client. Callback: `<DIOS_PUBLIC_ORIGIN>/dios/auth/callback`. Store its secret and runtime DB credential in Secret Manager, not GitHub source or chat.
7. Deploy the container defined by `cloudrun/dios/Dockerfile`. Entry is `node dist/dios-cloud.js`.
8. Check `/ready`, then actual Google login, save a non-sensitive test message, restart the service and retrieve it from both PC and iPhone. Test sign-out, all-session revocation and disabled membership. Do not declare live-ready on CI alone.
9. Configure one real read-only source and compare source counts, evidence and dates. Add additional connectors only after each passes its own live acceptance.

## Required runtime configuration
```
DIOS_RUNTIME_MODE=cloud-pilot
DIOS_TENANT_ID=<operator-enrolled-tenant>
DIOS_PUBLIC_ORIGIN=https://<confirmed-host>
DIOS_GOOGLE_CLIENT_ID=<web-client-id>
DIOS_GOOGLE_CLIENT_SECRET=<Secret-Manager-reference-at-deployment>
DIOS_DATABASE_URL=postgresql://<runtime-role>:<encoded-password>@<host>/<database>
DIOS_DATABASE_TRANSPORT=tls
NODE_ENV=production
LCC_COMMAND_MODE=production
ENABLE_DEV_ENDPOINTS=false
```
TLS validates the server; optional `DIOS_DATABASE_CA_PEM` supplies a trusted CA. Plain TCP is allowed only on localhost in NODE_ENV=test and is refused on Cloud Run. With a configured Cloud SQL connector, choose `cloudsql-socket` and set `DIOS_CLOUDSQL_SOCKET=/cloudsql/<project>:<region>:<instance>`; the connection parser preserves the socket instead of overriding it with a connection URL. URL TLS/query options are rejected.

## Verification and recovery
`tests/dios/cloud/security.test.ts` is offline verification. `postgres.test.ts` requires a disposable local PostgreSQL database ending in `_test`; `DIOS_CLOUD_TEST_REQUIRED=true` fails rather than hiding missing database coverage. `scripts/dios/restore-smoke.mjs` only runs against the CI service container/database. It restores actual synthetic records and compares them; it deliberately excludes sessions and OAuth state. It is not evidence of configured production backups. Production PITR, encrypted backups, restore drills and retention remain release gates.

## Deferred work, not disguised as complete
Live domain/Google consent, all selected SaaS/bank credentials, staff/partner tenancy and authorization, signed URLs/cloud generated-artifact storage, migrated event workers, retained consent/history policies, actual device acceptance, production restore drill and service monitoring. The original long-term feature scope is retained; this owner-pilot is an incremental validated slice, not a reduced definition of the final DIOS.
