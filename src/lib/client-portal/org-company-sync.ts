/**
 * Idempotent bridge between CRM `companies` (geistdesk_documents) and SQL `organizations`.
 * Canonical tenant identity is `organizations`; CRM contacts/tickets keep using company ids
 * via organizations.crm_company_id ↔ companies.data.organizationId.
 */

import { randomUUID } from 'crypto';
import { getDocsDirect, queryDb, setDocDirect, updateDocDirect } from '../postgres-backend.js';
import {
  createOrganization,
  getOrganization,
  listOrganizations,
  updateOrganization,
  type OrganizationRecord,
} from './organizations.js';

export const DEMO_COMPANY_NAMES = [
  'Acme Global Solutions',
  'CyberDyne Systems',
  'FinStream Inc.',
  'Globex Corporation',
  'Initech',
  'Umbrella Corp',
] as const;

function norm(s: string | null | undefined): string {
  return String(s || '')
    .trim()
    .toLowerCase();
}

function slugify(input: string): string {
  return (
    String(input || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || `org-${randomUUID().slice(0, 8)}`
  );
}

function isDemoCompanyName(name: string): boolean {
  const n = norm(name);
  return DEMO_COMPANY_NAMES.some((d) => norm(d) === n);
}

export type CompanyDoc = {
  id: string;
  name?: string;
  domain?: string;
  website?: string;
  logoUrl?: string;
  branche?: string;
  organizationId?: string | null;
  organization_id?: string | null;
  is_demo?: boolean;
  isDemoData?: boolean;
  tier?: string;
  contractSla?: string;
  contractRenewalDate?: string;
  [key: string]: unknown;
};

function companyOrgId(c: CompanyDoc): string | null {
  const id = c.organizationId || c.organization_id;
  return id ? String(id) : null;
}

async function listCompanyDocs(): Promise<CompanyDoc[]> {
  const rows = await getDocsDirect('companies', []);
  return rows.map((r) => ({ id: r.id, ...(r.data || r) })) as CompanyDoc[];
}

/** Ensure a CRM company document exists for an organization. Returns company id. */
export async function ensureCompanyForOrganization(
  org: OrganizationRecord,
): Promise<string> {
  if (org.crm_company_id) {
    const all = await listCompanyDocs();
    const hit = all.find((c) => c.id === org.crm_company_id);
    if (hit) {
      if (companyOrgId(hit) !== org.id) {
        await updateDocDirect('companies', hit.id, {
          organizationId: org.id,
          organization_id: org.id,
          updatedAt: new Date().toISOString(),
        });
      }
      return hit.id;
    }
  }

  const companies = await listCompanyDocs();
  const byDomain =
    org.domain &&
    companies.find((c) => c.domain && norm(c.domain) === norm(org.domain));
  const byName = companies.find((c) => norm(c.name) === norm(org.name));
  const match = byDomain || byName;
  if (match) {
    await updateDocDirect('companies', match.id, {
      organizationId: org.id,
      organization_id: org.id,
      name: org.name || match.name,
      domain: org.domain || match.domain || slugify(org.name),
      logoUrl: org.logo_url || match.logoUrl || '',
      website: org.website || match.website || '',
      is_demo: org.is_demo || match.is_demo || match.isDemoData || false,
      isDemoData: org.is_demo || match.isDemoData || false,
      updatedAt: new Date().toISOString(),
    });
    if (org.crm_company_id !== match.id) {
      await updateOrganization(org.id, { crm_company_id: match.id });
    }
    return match.id;
  }

  const companyId = `co-${org.id.replace(/-/g, '').slice(0, 16)}`;
  const now = new Date().toISOString();
  await setDocDirect('companies', companyId, {
    name: org.name,
    domain: org.domain || `${org.slug}.local`,
    website: org.website || '',
    logoUrl: org.logo_url || '',
    branche: (org.industry as any) || 'Other',
    wartungsvertragStatus: 'Active',
    phoneNumbers: [],
    organizationId: org.id,
    organization_id: org.id,
    is_demo: org.is_demo,
    isDemoData: org.is_demo,
    tier: org.tier || 'Standard',
    contractSla: org.sla || '',
    contractRenewalDate: org.contract_renewal || '',
    createdAt: now,
    updatedAt: now,
  });
  await updateOrganization(org.id, { crm_company_id: companyId });
  return companyId;
}

/** Ensure an organization exists for a CRM company. Returns organization id. */
export async function ensureOrganizationForCompany(
  company: CompanyDoc,
): Promise<string> {
  const linked = companyOrgId(company);
  if (linked) {
    const org = await getOrganization(linked);
    if (org) {
      if (org.crm_company_id !== company.id) {
        await updateOrganization(org.id, { crm_company_id: company.id });
      }
      return org.id;
    }
  }

  const orgs = await listOrganizations({ includeInactive: true });
  const byDomain =
    company.domain &&
    orgs.find((o) => o.domain && norm(o.domain) === norm(company.domain));
  const byName = orgs.find((o) => norm(o.name) === norm(company.name || ''));
  const byCrm = orgs.find((o) => o.crm_company_id === company.id);
  const match = byCrm || byDomain || byName;

  const demo =
    Boolean(company.is_demo) ||
    Boolean(company.isDemoData) ||
    isDemoCompanyName(String(company.name || ''));

  if (match) {
    await updateOrganization(match.id, {
      crm_company_id: company.id,
      name: String(company.name || match.name),
      domain: company.domain || match.domain,
      website: (company.website as string) || match.website,
      logo_url: (company.logoUrl as string) || match.logo_url,
      industry: (company.branche as string) || match.industry,
      tier: (company.tier as string) || match.tier,
      sla: (company.contractSla as string) || match.sla,
      contract_renewal:
        (company.contractRenewalDate as string) || match.contract_renewal,
      is_demo: demo || match.is_demo,
    });
    await updateDocDirect('companies', company.id, {
      organizationId: match.id,
      organization_id: match.id,
      is_demo: demo || company.is_demo || false,
      isDemoData: demo || company.isDemoData || false,
      updatedAt: new Date().toISOString(),
    });
    return match.id;
  }

  const org = await createOrganization({
    name: String(company.name || 'Unnamed'),
    slug: slugify(String(company.name || company.domain || 'company')),
    domain: company.domain ? String(company.domain).toLowerCase() : null,
    website: company.website ? String(company.website) : null,
    industry: company.branche ? String(company.branche) : null,
    tier: company.tier ? String(company.tier) : null,
    sla: company.contractSla ? String(company.contractSla) : null,
    contract_renewal: company.contractRenewalDate
      ? String(company.contractRenewalDate)
      : null,
    logo_url: company.logoUrl ? String(company.logoUrl) : null,
    is_demo: demo,
    crm_company_id: company.id,
    is_active: true,
    settings: {},
  });

  await updateDocDirect('companies', company.id, {
    organizationId: org.id,
    organization_id: org.id,
    is_demo: demo,
    isDemoData: demo,
    updatedAt: new Date().toISOString(),
  });

  return org.id;
}

export interface OrgCompanySyncResult {
  companiesProcessed: number;
  organizationsProcessed: number;
  linked: number;
  createdOrgs: number;
  createdCompanies: number;
}

/**
 * Idempotent bidirectional sync — safe to run on every boot.
 */
export async function syncCompaniesAndOrganizations(): Promise<OrgCompanySyncResult> {
  const result: OrgCompanySyncResult = {
    companiesProcessed: 0,
    organizationsProcessed: 0,
    linked: 0,
    createdOrgs: 0,
    createdCompanies: 0,
  };

  try {
    const companiesBefore = await listCompanyDocs();
    const orgsBefore = await listOrganizations({ includeInactive: true });
    result.companiesProcessed = companiesBefore.length;
    result.organizationsProcessed = orgsBefore.length;

    for (const company of companiesBefore) {
      const before = companyOrgId(company);
      const orgId = await ensureOrganizationForCompany(company);
      if (!before) result.createdOrgs += 1;
      else result.linked += 1;
      void orgId;
    }

    const orgsAfter = await listOrganizations({ includeInactive: true });
    for (const org of orgsAfter) {
      const before = org.crm_company_id;
      const companyId = await ensureCompanyForOrganization(org);
      if (!before) result.createdCompanies += 1;
      void companyId;
    }

    // Tag fixture names as demo on both sides
    await queryDb(
      `UPDATE organizations
          SET is_demo = TRUE, updated_at = NOW()
        WHERE LOWER(TRIM(name)) = ANY($1::text[])`,
      [DEMO_COMPANY_NAMES.map((n) => n.toLowerCase())],
    );
  } catch (err) {
    console.warn('[org-company-sync] sync failed (non-fatal):', (err as any)?.message || err);
  }

  return result;
}

/** Ensure portal user also exists as a CRM contact on the linked company. */
export async function ensureContactForPortalUser(params: {
  organizationId: string;
  name: string;
  email: string;
  role: string;
  userId?: string;
  invitationStatus?: string | null;
}): Promise<string | null> {
  const org = await getOrganization(params.organizationId);
  if (!org) return null;
  const companyId =
    org.crm_company_id || (await ensureCompanyForOrganization(org));
  const email = params.email.toLowerCase().trim();
  // getDocsDirect returns flattened docs — do not read hit.data.metadata.
  const existing = await getDocsDirect('contacts', [
    { type: 'where', field: 'email', op: '==', value: email },
  ]);
  const sameCompany = existing.filter(
    (c) => String(c.companyId || '') === String(companyId),
  );
  const now = new Date().toISOString();
  const metaPatch = {
    portalRole: params.role,
    portalUserId: params.userId || null,
    syncedFromPortal: true,
    role: 'portal_user',
    invitationStatus: params.invitationStatus || null,
  };

  if (sameCompany.length > 0) {
    const hit = sameCompany[0];
    const prevMeta =
      hit.metadata && typeof hit.metadata === 'object' && !Array.isArray(hit.metadata)
        ? (hit.metadata as Record<string, unknown>)
        : {};
    await updateDocDirect('contacts', hit.id, {
      companyId,
      name: params.name,
      title: params.role || hit.title || '',
      metadata: { ...prevMeta, ...metaPatch },
      updatedAt: now,
    });
    return hit.id;
  }

  const contactId = `ct-portal-${randomUUID().slice(0, 10)}`;
  await setDocDirect('contacts', contactId, {
    companyId,
    name: params.name,
    email,
    title: params.role,
    phoneWork: '',
    phoneMobile: '',
    address: '',
    metadata: metaPatch,
    createdAt: now,
    updatedAt: now,
  });
  return contactId;
}
