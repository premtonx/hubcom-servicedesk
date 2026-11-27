# Hubcom ServiceDesk — Architecture

## Topology

| Service | Role |
|---|---|
| `caddy` | TLS reverse proxy (profile `caddy`) → frontend + gateway |
| `frontend` | Static Vite build (nginx/static image) |
| `geistdesk-gateway` | Node API (`server.ts` / `dist/server.cjs`) |
| `geistdesk-db` | PostgreSQL + **pgvector** |

Compose: `docker-compose.yml` (+ optional `docker-compose.traefik.yml`).

Data durability:

- Postgres volume `geistdesk_db_data` — documents JSONB, `organizations`, `organization_vault_secrets`, embeddings.
- `geistdesk_documents` volume → `/app/storage/documents` (KB file blobs).
- Logos / portal banners / org vault ciphertext live in **Postgres** (survive rebuilds).

## Subsystem map

| Area | Paths |
|---|---|
| DB init / migrations | `src/lib/postgres-backend.ts` (`initDb`), `prisma/migrations/*` |
| Auth / JWT / Entra | `src/middleware/authMiddleware.ts`, `src/routes/microsoftAuthRoutes.ts`, `src/lib/entra/*` |
| Portal RBAC middleware | `src/middleware/clientPortalMiddleware.ts`, `src/lib/client-portal/roles.ts` |
| Organizations | `src/lib/client-portal/organizations.ts`, `src/routes/organizationAdminRoutes.ts` |
| Portal APIs | `src/routes/clientPortalRoutes.ts`, `clientPortalTeamRoutes`, `clientPortalEmailRoutes`, `clientPortalKbRoutes`, `clientPortalExchangeRoutes`, `clientPortalVaultRoutes` — mounted under `/api/portal/*` in `server.ts` |
| Tickets + org stamp | `src/routes/ticketRoutes.ts`, `src/lib/client-portal/stamp-ticket-organization.ts`, `ticket-visibility.ts` |
| Hardware-Rücklieferungen (org-gated) | `organizations.hardware_returns_enabled` + `ticket_hardware_returns`; `hardware-returns.ts` + `hardware-returns-recipients.ts` + `hardware-returns-escalation.ts` + hourly scheduler; `/api/returns` + `/api/portal/returns`; workbench `/returns` + `/portal/returns` |
| Graph / email | `src/lib/email-ingestion/*` (drivers, scheduler, channel-store), `src/routes/*email*` |
| Vault crypto | `src/lib/crypto.ts` (`VAULT_ENCRYPTION_KEY`), org Tresor `src/lib/client-portal/organization-vault.ts` |
| Secure Exchange | `src/routes/vaultRoutes.ts`, `src/routes/clientPortalExchangeRoutes.ts` |
| Admin-Hub shell | `src/components/admin/hub/AdminHubLayout.tsx`, `adminHubConfig.ts` |
| Kunden-Portal UI | `src/components/client-portal/ClientPortalLayout.tsx`, `src/components/pages/client-portal/*`, routes in `src/App.tsx` `/portal/*` |
| Generic `/api/db` policy | `src/lib/db-access-policy.ts` (`DB_CLIENT_PORTAL_COLLECTIONS`) |

## Portal surfaces

| Path | Roles |
|---|---|
| `/portal` Übersicht | all `CLIENT_*` |
| `/portal/tickets` | all `CLIENT_*` |
| `/portal/kb` | all (write: ADMIN/SUPPORTER); API `/api/portal/kb*` only |
| `/portal/exchange` | all (scoped) |
| `/portal/vault` | ADMIN/SUPPORTER only |
| `/portal/members`, `/email`, `/branding` | `CLIENT_ADMIN` |

**Shared UI, Separate APIs:** Prefer one shared presentational workbench (`mode: 'staff' | 'portal'` + typed adapter) over a forked portal UI. Portal pages call `/api/portal/*` exclusively; staff keep staff APIs. See `AGENTS.md`.

## Multi-tenant PostgreSQL RLS

Defense-in-depth isolation uses **Row Level Security** plus transaction-local GUCs
(`app.rls_mode`, `app.current_org_id`, `app.allowed_org_ids`) set via
`withTenantContext` / `SET LOCAL` (never session-global — pooled connections cannot bleed).

| Mode | Who | Effect |
|---|---|---|
| `portal` | `CLIENT_*` | Only rows for `app.current_org_id` |
| `staff_scoped` | `HUBCOM_ADMIN` / `AGENT` / `USER` | Internal (`organization_id IS NULL`) + allowed org ids |
| `super_admin` / `system` | `SUPER_ADMIN`, workers | Full access |
| unset | — | Fail closed (`false`) |

Covered: `geistdesk_documents` (tickets / messages / KB JSONB), `"KnowledgeEmbedding"`,
`ticket_hardware_returns`, `organizations`, vault/directory/access tables.
Convenience views: `tickets`, `kb_articles`, `ticket_messages`.

### Optional `hubcom_app` role (`NOBYPASSRLS`)

`initDb` creates role `hubcom_app` and grants it to the migration user. Runtime
transactions `SET LOCAL ROLE hubcom_app` so RLS applies. For a dedicated runtime
login, create a passworded role and set `DATABASE_APP_URL` (owner URL stays on
`DATABASE_URL` for migrations):

```sql
-- Run as Postgres superuser / table owner once:
CREATE ROLE hubcom_app LOGIN PASSWORD 'choose-a-strong-secret' NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO hubcom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hubcom_app;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA public TO hubcom_app;
```

Then set `DATABASE_APP_URL=postgresql://hubcom_app:...@db:5432/geistdesk` on the gateway.
When `DATABASE_APP_URL` is active, init also `FORCE ROW LEVEL SECURITY` on core tables.
Owner `DATABASE_URL` stays available for migrations; the runtime pool uses `hubcom_app`.

**Boot / pre-auth:** `ensureDefaultTicketConfig`, `ensureOnboardingState` /
`ensureInitializationFlag`, workers, `/api/auth/*`, `/api/admin/onboarding/*`, and
system-favicon run inside `withTenantContext({ mode: 'system' })` (or
`systemRlsMiddleware`) so FORCE RLS never returns `42501` or a false
uninitialized status. Portal/staff routes keep strict org isolation.

Code: `src/lib/security/tenant-rls*.ts`, wired on `/api/portal` + `/api/returns` +
system middleware on auth/onboarding.

## Required environment

Core (compose-required):

- `GEISTDESK_DATABASE_URL` / `DATABASE_URL`, `POSTGRES_*`
- `JWT_SECRET`, `VAULT_ENCRYPTION_KEY`
- `PUBLIC_APP_URL`, `DOMAIN` / `DOMAIN_NAME`

Strongly recommended:

- `DATABASE_APP_URL` (optional `hubcom_app` NOBYPASSRLS runtime URL; compose forwards `${DATABASE_APP_URL:-}`)
- `TRUST_PROXY` (compose default `1` behind Traefik/Nginx so rate limits/bans see the real client IP)
- `AI_SECRETS_KEY`, `MASTER_KEY_SALT`, `EMAIL_CHANNEL_SECRET_KEY`
- `INBOUND_MAIL_WEBHOOK_SECRET`, `INBOUND_EMAIL_DOMAIN`, `EMAIL_INGESTION_INTERVAL_MS`
- Graph/OIDC: `MICROSOFT_PROVIDER_CLIENT_ID`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`, `OIDC_*`, `GRAPH_CLIENT_STATE_SECRET`
- AI: `OPENAI_API_KEY`, `AZURE_OPENAI_*`, `GEMINI_API_KEY`, `OLLAMA_ENDPOINT`, `EMBEDDING_*`
- Outbound: `SMTP_HOST`, `SMTP_USER`, `MAIL_DISPATCH_URL`, `MAIL_FROM_ADDRESS`

Template: `.env.example`. Gateway env pass-through: `docker-compose.yml` → `geistdesk-gateway`.

## Verification

`npx tsc --noEmit` · `npm run build` · `npm run test:portal-isolation` · `npm run test:lifecycle` · `npm run test:email-html`
