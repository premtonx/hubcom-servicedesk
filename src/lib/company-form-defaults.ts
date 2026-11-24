/**
 * Blank defaults for „Unternehmen registrieren“.
 * No demo/fixture customer, contact, or account-manager values.
 */

export type NewCompanyFormState = {
  name: string;
  slug: string;
  domain: string;
  website: string;
  logoUrl: string;
  branche: string;
  companySize: string;
  tier: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  primaryContactTitle: string;
  country: string;
  timezone: string;
  address: string;
  /** Display name of Hubcom staff owner (derived from selected user). */
  accountOwner: string;
  /** User id of Hubcom staff owner; empty until explicitly chosen. */
  accountOwnerId: string;
  internalNotes: string;
  wartungsvertragStatus: string;
  healthScore: number | null;
  contractPlan: string;
  contractSla: string;
  contractRenewalDate: string;
  monthlySpend: string;
  usersCount: number | null;
  assetsCount: number | null;
  vaultEntriesCount: number | null;
  slaPerformance: string;
};

/** Customer-specific fields start empty. System-ish selects stay empty until chosen. */
export function blankNewCompanyForm(): NewCompanyFormState {
  return {
    name: '',
    slug: '',
    domain: '',
    website: '',
    logoUrl: '',
    branche: '',
    companySize: '',
    tier: '',
    primaryContactName: '',
    primaryContactEmail: '',
    primaryContactPhone: '',
    primaryContactTitle: '',
    country: '',
    timezone: '',
    address: '',
    accountOwner: '',
    accountOwnerId: '',
    internalNotes: '',
    wartungsvertragStatus: '',
    healthScore: null,
    contractPlan: '',
    contractSla: '',
    contractRenewalDate: '',
    monthlySpend: '',
    usersCount: null,
    assetsCount: null,
    vaultEntriesCount: null,
    slaPerformance: '',
  };
}

/** Fixture strings that must never appear as form defaults. */
export const FORBIDDEN_NEW_COMPANY_FIXTURES = [
  'Citadelle AG',
  'Premton Xhafa',
  'Sarah James',
  'John Smith',
  'john.smith@acme.com',
  'Acme Global Solutions',
  'Michael Scott',
  'Jim Halpert',
  'Dwight Schrute',
  'Pam Beesly',
  'Friedrichstraße 123',
  'Enterprise Plus',
  '+49 123 456 7890',
] as const;
