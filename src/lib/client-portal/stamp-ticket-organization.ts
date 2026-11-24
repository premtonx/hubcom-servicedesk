/**
 * Stamp canonical organizationId onto Hubcom-staff-created tickets so
 * CLIENT_ADMIN / CLIENT_SUPPORTER "Alle Firmen-Tickets" can see them.
 *
 * Tickets live in geistdesk_documents JSONB — there is no SQL tickets table.
 * organizationId is stored as data.organizationId (+ organization_id alias).
 */

import { getDocDirect, getDocsDirect, updateDocDirect } from '../postgres-backend.js';
import {
  ensureOrganizationForCompany,
  type CompanyDoc,
} from './org-company-sync.js';
import { getOrganization, listOrganizations } from './organizations.js';
import { ticketOrganizationId } from './ticket-visibility.js';

function norm(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function looksLikeEmail(value: unknown): boolean {
  const s = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Pure merge helper — used by staff create path and unit tests.
 * Resolves organizationId from an already-known org id or company→org map.
 */
export function applyTicketOrganizationStamp(
  data: Record<string, unknown>,
  resolved: {
    organizationId: string | null;
    companyName?: string | null;
    companyId?: string | null;
  },
): Record<string, unknown> {
  const next = { ...data };
  const orgId =
    (typeof resolved.organizationId === 'string' && resolved.organizationId.trim()) ||
    ticketOrganizationId(next) ||
    '';

  if (orgId) {
    next.organizationId = orgId;
    next.organization_id = orgId;
  }

  const companyName =
    (typeof resolved.companyName === 'string' && resolved.companyName.trim()) ||
    (typeof next.company === 'string' && next.company.trim()) ||
    '';
  if (companyName) next.company = companyName;

  const companyId =
    (typeof resolved.companyId === 'string' && resolved.companyId.trim()) ||
    (typeof next.companyId === 'string' && next.companyId.trim()) ||
    '';
  if (companyId) next.companyId = companyId;

  // Normalize requester / customer email fields for Kunde tab + Graph replies.
  const emailFromPayload =
    (typeof next.customerEmail === 'string' && next.customerEmail.trim()) ||
    (looksLikeEmail(next.customerId) ? String(next.customerId).trim() : '') ||
    '';
  if (emailFromPayload) {
    next.customerEmail = emailFromPayload;
  }

  const requester =
    (typeof next.requesterId === 'string' && next.requesterId.trim()) ||
    (typeof next.requester_id === 'string' && next.requester_id.trim()) ||
    '';
  if (requester) {
    next.requesterId = requester;
    next.requester_id = requester;
  }

  // Never leave a bare "@domain.com" style customerId when email is known.
  if (
    emailFromPayload &&
    (!next.customerId ||
      String(next.customerId).trim() === '' ||
      String(next.customerId).trim() === '@domain.com')
  ) {
    next.customerId = emailFromPayload;
  }

  return next;
}

/** Resolve organization UUID for a CRM company document id. */
export async function resolveOrganizationIdForCompanyId(
  companyId: string | null | undefined,
): Promise<{ organizationId: string | null; companyName: string | null; company: CompanyDoc | null }> {
  const id = String(companyId || '').trim();
  if (!id) return { organizationId: null, companyName: null, company: null };

  const company = (await getDocDirect('companies', id)) as CompanyDoc | null;
  if (!company) return { organizationId: null, companyName: null, company: null };

  const name = String(company.name || '').trim() || null;
  const linked =
    (typeof company.organizationId === 'string' && company.organizationId.trim()) ||
    (typeof (company as any).organization_id === 'string' &&
      String((company as any).organization_id).trim()) ||
    '';

  if (linked) {
    const org = await getOrganization(linked);
    if (org) return { organizationId: org.id, companyName: name, company };
  }

  try {
    const orgId = await ensureOrganizationForCompany({ ...company, id });
    return { organizationId: orgId, companyName: name, company: { ...company, id } };
  } catch {
    // Fall through to name/domain match without creating.
  }

  const orgs = await listOrganizations({ includeInactive: true });
  const byCrm = orgs.find((o) => o.crm_company_id === id);
  const byDomain =
    company.domain &&
    orgs.find((o) => o.domain && norm(o.domain) === norm(company.domain));
  const byName = name ? orgs.find((o) => norm(o.name) === norm(name)) : undefined;
  const match = byCrm || byDomain || byName || null;
  return {
    organizationId: match?.id || null,
    companyName: name,
    company: { ...company, id },
  };
}

/**
 * Stamp organization + company display fields onto a staff ticket create payload.
 * Idempotent when organizationId is already present.
 */
export async function stampStaffTicketOrganizationFields(
  data: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown>> {
  const base = data && typeof data === 'object' ? { ...data } : {};
  const existing = ticketOrganizationId(base);
  const companyId =
    (typeof base.companyId === 'string' && base.companyId.trim()) ||
    (typeof base.company_id === 'string' && base.company_id.trim()) ||
    '';

  if (existing && !companyId) {
    return applyTicketOrganizationStamp(base, { organizationId: existing });
  }

  if (companyId) {
    const resolved = await resolveOrganizationIdForCompanyId(companyId);
    return applyTicketOrganizationStamp(base, {
      organizationId: resolved.organizationId || existing,
      companyName: resolved.companyName,
      companyId,
    });
  }

  // No companyId — try matching free-text company name / domain against orgs.
  const companyName =
    (typeof base.company === 'string' && base.company.trim()) ||
    (typeof base.customerCompany === 'string' && base.customerCompany.trim()) ||
    '';
  if (companyName) {
    const orgs = await listOrganizations({ includeInactive: true });
    const match = orgs.find((o) => norm(o.name) === norm(companyName));
    if (match) {
      return applyTicketOrganizationStamp(base, {
        organizationId: match.id,
        companyName: match.name,
        companyId: match.crm_company_id || null,
      });
    }
  }

  return applyTicketOrganizationStamp(base, { organizationId: existing });
}

/**
 * Idempotent backfill: set organizationId on tickets that only have companyId /
 * company name / domain matching an organizations row.
 */
export async function backfillTicketOrganizationIds(): Promise<{
  scanned: number;
  updated: number;
}> {
  const tickets = (await getDocsDirect('tickets', [])) as Array<Record<string, unknown>>;
  let updated = 0;
  for (const ticket of tickets) {
    const id = String(ticket.id || '');
    if (!id) continue;
    if (ticketOrganizationId(ticket)) continue;

    const stamped = await stampStaffTicketOrganizationFields(ticket);
    const orgId = ticketOrganizationId(stamped);
    if (!orgId) continue;

    await updateDocDirect('tickets', id, {
      organizationId: orgId,
      organization_id: orgId,
      ...(typeof stamped.company === 'string' && stamped.company
        ? { company: stamped.company }
        : {}),
      ...(typeof stamped.companyId === 'string' && stamped.companyId
        ? { companyId: stamped.companyId }
        : {}),
      updatedAt: new Date().toISOString(),
    });
    updated += 1;
  }
  return { scanned: tickets.length, updated };
}
