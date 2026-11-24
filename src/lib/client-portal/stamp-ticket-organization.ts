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
import { getOrganization, listOrganizations, type OrganizationRecord } from './organizations.js';
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

function emailDomain(value: unknown): string {
  const s = String(value || '').trim().toLowerCase();
  if (!s.includes('@')) return '';
  return s.split('@').pop()?.trim() || '';
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

  const customerName =
    (typeof next.customerName === 'string' && next.customerName.trim()) ||
    (typeof next.customer_name === 'string' && String(next.customer_name).trim()) ||
    '';
  if (customerName) {
    next.customerName = customerName;
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

/** Match an organizations row by email domain (e.g. premton@citadelle.de → citadelle.de). */
export function matchOrganizationByEmailDomain(
  orgs: OrganizationRecord[],
  email: string | null | undefined,
): OrganizationRecord | null {
  const domain = emailDomain(email);
  if (!domain) return null;
  return (
    orgs.find((o) => o.domain && norm(o.domain) === domain) ||
    orgs.find((o) => o.domain && domain.endsWith(`.${norm(o.domain)}`)) ||
    null
  );
}

/** Match an organizations row by display name (case-insensitive). */
export function matchOrganizationByName(
  orgs: OrganizationRecord[],
  name: string | null | undefined,
): OrganizationRecord | null {
  const n = norm(name);
  if (!n) return null;
  return orgs.find((o) => norm(o.name) === n) || null;
}

/** Resolve organization UUID for a CRM company document id. */
export async function resolveOrganizationIdForCompanyId(
  companyId: string | null | undefined,
): Promise<{ organizationId: string | null; companyName: string | null; company: CompanyDoc | null }> {
  const id = String(companyId || '').trim();
  if (!id) return { organizationId: null, companyName: null, company: null };

  // companyId may already be an organizations.id (UI sometimes uses org as Unternehmen).
  const asOrg = await getOrganization(id);
  if (asOrg) {
    return {
      organizationId: asOrg.id,
      companyName: asOrg.name,
      company: asOrg.crm_company_id
        ? ({ id: asOrg.crm_company_id, name: asOrg.name, organizationId: asOrg.id } as CompanyDoc)
        : null,
    };
  }

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

  // Prefer matching an existing portal org BEFORE creating a new one (avoids dual-org split).
  const orgs = await listOrganizations({ includeInactive: true });
  const byCrm = orgs.find((o) => o.crm_company_id === id);
  const byDomain =
    company.domain &&
    orgs.find((o) => o.domain && norm(o.domain) === norm(company.domain));
  const byName = name ? matchOrganizationByName(orgs, name) : null;
  const existingMatch = byCrm || byDomain || byName || null;
  if (existingMatch) {
    try {
      await ensureOrganizationForCompany({ ...company, id });
    } catch {
      /* link best-effort */
    }
    return {
      organizationId: existingMatch.id,
      companyName: name || existingMatch.name,
      company: { ...company, id },
    };
  }

  try {
    const orgId = await ensureOrganizationForCompany({ ...company, id });
    return { organizationId: orgId, companyName: name, company: { ...company, id } };
  } catch {
    return { organizationId: null, companyName: name, company: { ...company, id } };
  }
}

/**
 * Resolve the best organizations.id for a ticket payload from companyId,
 * company name, email domain, or an already-valid organizationId.
 */
export async function resolveBestOrganizationId(
  data: Record<string, unknown>,
): Promise<{
  organizationId: string | null;
  companyName: string | null;
  companyId: string | null;
}> {
  const companyId =
    (typeof data.companyId === 'string' && data.companyId.trim()) ||
    (typeof data.company_id === 'string' && data.company_id.trim()) ||
    '';

  if (companyId) {
    const resolved = await resolveOrganizationIdForCompanyId(companyId);
    if (resolved.organizationId) {
      return {
        organizationId: resolved.organizationId,
        companyName: resolved.companyName,
        companyId: resolved.company?.id || companyId,
      };
    }
  }

  const orgs = await listOrganizations({ includeInactive: true });

  const existing = ticketOrganizationId(data);
  if (existing) {
    const org = await getOrganization(existing);
    if (org) {
      return {
        organizationId: org.id,
        companyName: org.name,
        companyId: org.crm_company_id || companyId || null,
      };
    }
  }

  const companyName =
    (typeof data.company === 'string' && data.company.trim()) ||
    (typeof data.customerCompany === 'string' && data.customerCompany.trim()) ||
    '';
  const byName = matchOrganizationByName(orgs, companyName);
  if (byName) {
    return {
      organizationId: byName.id,
      companyName: byName.name,
      companyId: byName.crm_company_id || companyId || null,
    };
  }

  const email =
    (typeof data.customerEmail === 'string' && data.customerEmail.trim()) ||
    (looksLikeEmail(data.customerId) ? String(data.customerId).trim() : '') ||
    (typeof data.from_email === 'string' && data.from_email.trim()) ||
    '';
  const byEmail = matchOrganizationByEmailDomain(orgs, email);
  if (byEmail) {
    return {
      organizationId: byEmail.id,
      companyName: byEmail.name,
      companyId: byEmail.crm_company_id || companyId || null,
    };
  }

  return { organizationId: null, companyName: companyName || null, companyId: companyId || null };
}

/**
 * Stamp organization + company display fields onto a staff ticket create payload.
 * Idempotent when organizationId is already present and valid.
 */
export async function stampStaffTicketOrganizationFields(
  data: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown>> {
  const base = data && typeof data === 'object' ? { ...data } : {};
  const best = await resolveBestOrganizationId(base);
  return applyTicketOrganizationStamp(base, {
    organizationId: best.organizationId,
    companyName: best.companyName,
    companyId: best.companyId,
  });
}

/**
 * Idempotent backfill: set / repair organizationId on tickets using companyId,
 * company name, or customer_email domain. Also fixes mismatched org ids when
 * company/email clearly belongs to a different organizations row.
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

    const current = ticketOrganizationId(ticket);
    const stamped = await stampStaffTicketOrganizationFields(ticket);
    const orgId = ticketOrganizationId(stamped);
    if (!orgId) continue;
    if (current === orgId) continue;

    await updateDocDirect('tickets', id, {
      organizationId: orgId,
      organization_id: orgId,
      ...(typeof stamped.company === 'string' && stamped.company
        ? { company: stamped.company }
        : {}),
      ...(typeof stamped.companyId === 'string' && stamped.companyId
        ? { companyId: stamped.companyId }
        : {}),
      ...(typeof stamped.customerEmail === 'string' && stamped.customerEmail
        ? { customerEmail: stamped.customerEmail }
        : {}),
      ...(typeof stamped.requesterId === 'string' && stamped.requesterId
        ? { requesterId: stamped.requesterId, requester_id: stamped.requesterId }
        : {}),
      updatedAt: new Date().toISOString(),
    });
    updated += 1;
  }
  return { scanned: tickets.length, updated };
}
