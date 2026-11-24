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
| `/portal/kb` | all (write: ADMIN/SUPPORTER) |
| `/portal/exchange` | all (scoped) |
| `/portal/vault` | ADMIN/SUPPORTER only |
| `/portal/members`, `/email`, `/branding` | `CLIENT_ADMIN` |

## Required environment

Core (compose-required):

- `GEISTDESK_DATABASE_URL` / `DATABASE_URL`, `POSTGRES_*`
- `JWT_SECRET`, `VAULT_ENCRYPTION_KEY`
- `PUBLIC_APP_URL`, `DOMAIN` / `DOMAIN_NAME`

Strongly recommended:

- `AI_SECRETS_KEY`, `MASTER_KEY_SALT`, `EMAIL_CHANNEL_SECRET_KEY`
- `INBOUND_MAIL_WEBHOOK_SECRET`, `INBOUND_EMAIL_DOMAIN`, `EMAIL_INGESTION_INTERVAL_MS`
- Graph/OIDC: `MICROSOFT_PROVIDER_CLIENT_ID`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`, `OIDC_*`, `GRAPH_CLIENT_STATE_SECRET`
- AI: `OPENAI_API_KEY`, `AZURE_OPENAI_*`, `GEMINI_API_KEY`, `OLLAMA_ENDPOINT`, `EMBEDDING_*`
- Outbound: `SMTP_HOST`, `SMTP_USER`, `MAIL_DISPATCH_URL`, `MAIL_FROM_ADDRESS`

Template: `.env.example`. Gateway env pass-through: `docker-compose.yml` → `geistdesk-gateway`.

## Verification

`npx tsc --noEmit` · `npm run build` · `npm run test:portal-isolation` · `npm run test:lifecycle` · `npm run test:email-html`
