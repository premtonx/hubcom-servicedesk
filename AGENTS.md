# Hubcom ServiceDesk — Agent Guide

## Git (non-negotiable)

- Work only on remote **`hubcom`** → `premtonx/hubcom-servicedesk`.
- Branch from latest **`hubcom/main`**. Open PRs against **`hubcom/main`**.
- **Never** push feature work to `GeistDesk` / `origin` unless explicitly asked.
- Branch names: `cursor/<descriptive-name>-5292`.

## Multi-tenant model

Canonical tenant key: **`organizations.id`** (UUID).

| Entity | Link field |
|---|---|
| Portal users (`CLIENT_*`) | `organizationId` / `organization_id` on user doc |
| Tickets | `organizationId` (stamped on create / email ingest) |
| KB articles | `visibility` + optional `organizationId` |
| Secure Exchange (`vault_items`) | `organizationId` / `metadata.organizationId` |
| Company Tresor | `organization_vault_secrets.organization_id` |
| Email channels | org-scoped channel docs / Send-As |

CRM `companies.id` ≠ portal tenant. Bridge via `organizations.crm_company_id`.

## RBAC & security invariants

| Role | Scope |
|---|---|
| `SYSTEM_ADMIN` / Hubcom staff (`AGENT`, …) | Full Hubcom shell + Admin-Hub |
| `CLIENT_ADMIN` | Org-wide portal: tickets, team, email, branding, KB write, exchange, **Tresor** |
| `CLIENT_SUPPORTER` | Org-wide tickets/KB/exchange/Tresor (no branding/team; Tresor no delete) |
| `CLIENT_USER` | Own/participant tickets only; KB/exchange read/create rules; **no Tresor** (`403`) |

- Always derive tenant from **`req.user.organization_id`** (session). Never trust body/query spoof.
- Portal routes: `requireClientPortalRole` + strip spoof fields.
- **Tresor:** `client_visible` defaults **`false`**. Portal sees only `organization_id = session AND client_visible = true`.
- Encrypt with **`VAULT_ENCRYPTION_KEY`** (AES-256-GCM). Channel secrets may fall back to the same key; prefer `EMAIL_CHANNEL_SECRET_KEY`.
- Image uploads: PNG/JPEG/WebP ≤ 2 MB — **reject SVG**.
- Client portal boot must **not** call `/api/db` for `roles` (or other Hubcom-only collections). Use `/api/auth/session` + `/api/portal/*`.

## UI & localization

- Customer-facing UI: **German** labels.
- No hardcoded demo fixtures in production paths (`Acme`, `Sarah James`, `@domain.com` as real data, etc.).
- Admin-Hub: persistent vertical sidebar (`AdminHubLayout`).
- Ticket status/KPI filters: shared helpers (`src/lib/portal/status.ts`, dashboard format utils).
- HTML: sanitize on render; unwrap Outlook SafeLinks on ingest/send paths.

## Verify before PR

```bash
npx tsc --noEmit
npm run build
npm run test:portal-isolation
npm run test:lifecycle
npm run test:email-html
```

Cursor rule mirror: `.cursor/rules/hubcom.mdc`.
Architecture map: `docs/ARCHITECTURE.md`.
