import { useEffect, useState, type FormEvent, type MouseEvent } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { 
  Building2, 
  Plus, 
  Sparkles, 
  RefreshCw,
  Key,
  Users,
  Edit3,
  Search,
  Upload,
  BookOpen,
  X,
  Trash2,
  Shield,
  Mail,
  Phone,
  User,
  MapPin,
  Clock,
  Briefcase,
  Layers,
  ExternalLink,
  Check,
  Lock,
  Building,
  ArrowRight,
  Globe,
  ChevronLeft,
  Package,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription
} from '../../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Textarea } from '../../components/ui/textarea';
import { toast } from 'sonner';

// Services
import { customerService } from '../../services/customerService';
import { ticketService } from '../../services/ticketService';
import { vaultService } from '../../services/vaultService';
import { schemaService, CustomField } from '../../services/schemaService';
import { aiAccountService } from '../../services/aiAccountService';
import { Company, Contact, Ticket, VaultItem } from '../../types';

// Subcomponents
import CompanySidebar from './companies/CompanySidebar';
import CompanyHeader from './companies/CompanyHeader';
import CompanyKPI from './companies/CompanyKPI';
import CompanyOverviewTab from './companies/CompanyOverviewTab';
import CompanyOtherTabs from './companies/CompanyOtherTabs';
import CompanyPortalTab from './companies/CompanyPortalTab';
import CompanyReturnsTab from './companies/CompanyReturnsTab';
import { hydrateCompany } from './companies/utils';
import axios from 'axios';
import CSVImporter from '../CSVImporter';
import { useTranslation } from '../../lib/context/I18nContext';
import { useAuth } from '../../lib/hooks';
import { isHubcomStaffRole } from '../../lib/client-portal/roles';
import {
  blankNewCompanyForm,
  type NewCompanyFormState,
} from '../../lib/company-form-defaults';
import { parseAndValidateLogoDataUrl } from '../../lib/client-portal/org-branding';
import { buildCompanyKpiMetrics } from '../../lib/company-kpi-metrics';

const BRANCHES = [
  'Tech',
  'Finance',
  'Healthcare',
  'Manufacturing',
  'Retail',
  'Services',
  'Sonstige',
];

type StaffOption = { id: string; name: string; email: string; role: string };

export default function CustomersPage() {
  const { t } = useTranslation();
  const { user: authUser } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  
  const [employees, setEmployees] = useState<Contact[]>([]);
  const [ticketHistory, setTicketHistory] = useState<Ticket[]>([]);
  
  // Tracks all loaded tickets by company ID, to support dynamic ticket badge counts in sidebar
  const [ticketHistoryMap, setTicketHistoryMap] = useState<Record<string, Ticket[]>>({});

  const [activeSubTab, setActiveSubTab] = useState('overview');
  const [portalFocusInvite, setPortalFocusInvite] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('hubcom_unternehmen_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [companyVaultItems, setCompanyVaultItems] = useState<VaultItem[]>([]);
  const [orgEnrichment, setOrgEnrichment] = useState<Record<string, any>>({});
  /** orgId → logo + open counts from GET /api/admin/organizations */
  const [orgListMeta, setOrgListMeta] = useState<
    Record<
      string,
      {
        logo_url: string | null;
        open_tickets_count: number;
        open_returns_count: number;
        name?: string;
      }
    >
  >({});

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('hubcom_unternehmen_sidebar_collapsed', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  
  // Dialog controls
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isContactDialogOpen, setIsContactDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  
  const [contactSchema, setContactSchema] = useState<CustomField[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Pin / Favorite accounts
  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = localStorage.getItem('geistdesk_favorite_companies_v2');
    return saved ? JSON.parse(saved) : [];
  });

  const handleToggleFavorite = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    setFavorites(prev => {
      const isFav = prev.includes(id);
      const next = isFav ? prev.filter(item => item !== id) : [...prev, id];
      localStorage.setItem('geistdesk_favorite_companies_v2', JSON.stringify(next));
      if (!isFav) {
        toast.info("Company pinned to Favorites list!");
      } else {
        toast.info("Company unpinned from Favorites.");
      }
      return next;
    });
  };

  // Forms states — intentionally blank (no demo fixtures)
  const [newCompany, setNewCompany] = useState<NewCompanyFormState>(() => blankNewCompanyForm());
  const [staffOwners, setStaffOwners] = useState<StaffOption[]>([]);
  const [enrichmentApplied, setEnrichmentApplied] = useState(false);

  const [newContact, setNewContact] = useState<any>({
    name: '',
    email: '',
    title: '',
    phoneWork: '',
    phoneMobile: '',
    metadata: {}
  });

  const [editCompanyData, setEditCompanyData] = useState<any>({});
  const [draggingFile, setDraggingFile] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const urlId = searchParams.get('id');
  const navigate = useNavigate();

  useEffect(() => {
    if (searchParams.get('action') === 'create') {
      const nextQuery: Record<string, string> = {};
      if (urlId) nextQuery.id = urlId;
      setSearchParams(nextQuery, { replace: true });
      setIsCreateDialogOpen(true);
    }
  }, [searchParams, setSearchParams, urlId]);

  // Load basic custom schemas
  useEffect(() => {
    schemaService.getContactSchema().then(setContactSchema);
  }, []);

  // Account-manager candidates: active Hubcom staff from authorized admin API
  useEffect(() => {
    if (!isCreateDialogOpen && !isEditDialogOpen) return;
    let cancelled = false;
    void axios
      .get('/api/admin/users', { params: { page: 1, limit: 100 }, withCredentials: true })
      .then((res) => {
        if (cancelled) return;
        const rows = (res.data?.users || []) as Array<Record<string, unknown>>;
        const staff = rows
          .filter((u) => {
            const role = String(u.role || '');
            const status = String(u.status || '').toLowerCase();
            if (status === 'deactivated') return false;
            return isHubcomStaffRole(role) || u.is_admin === true || role === 'SYSTEM_ADMIN';
          })
          .map((u) => ({
            id: String(u.id),
            name: String(u.name || u.email || ''),
            email: String(u.email || ''),
            role: String(u.role || ''),
          }))
          .filter((u) => u.id && u.name)
          .sort((a, b) => a.name.localeCompare(b.name, 'de'));
        setStaffOwners(staff);

        // Default to signed-in admin only when eligible and nothing chosen yet
        setNewCompany((prev) => {
          if (prev.accountOwnerId) return prev;
          const selfId = authUser?.uid || (authUser as any)?.id;
          if (!selfId) return prev;
          const self = staff.find((s) => s.id === selfId);
          if (!self) return prev;
          return { ...prev, accountOwnerId: self.id, accountOwner: self.name };
        });
      })
      .catch(() => {
        if (!cancelled) setStaffOwners([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isCreateDialogOpen, isEditDialogOpen, authUser]);

  // Subscribe to all companies in the DB
  useEffect(() => {
    return customerService.subscribeToCompanies((data) => {
      setCompanies(data);
      if (data.length > 0) {
        if (urlId && data.find(c => c.id === urlId)) {
          setSelectedCompanyId(urlId);
        } else if (!selectedCompanyId) {
          setSelectedCompanyId(data[0].id);
        }
      }
    });
  }, [urlId]);

  // Admin org list: branding logos + open ticket/returns counts for sidebar
  useEffect(() => {
    let cancelled = false;
    void axios
      .get('/api/admin/organizations', { withCredentials: true })
      .then((res) => {
        if (cancelled) return;
        const rows = (res.data?.organizations || []) as Array<Record<string, unknown>>;
        const next: typeof orgListMeta = {};
        for (const o of rows) {
          const id = String(o.id || '');
          if (!id) continue;
          next[id] = {
            logo_url: (o.logo_url as string | null) || null,
            open_tickets_count: Number(o.open_tickets_count) || 0,
            open_returns_count: Number(o.open_returns_count) || 0,
            name: o.name ? String(o.name) : undefined,
          };
        }
        setOrgListMeta(next);
      })
      .catch(() => {
        /* sidebar falls back to CRM fields */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Handle active selected company state
  useEffect(() => {
    if (selectedCompanyId) {
      const baseComp = companies.find(c => c.id === selectedCompanyId) || null;
      const enriched = baseComp
        ? { ...baseComp, ...(orgEnrichment[selectedCompanyId] || {}) }
        : null;
      setSelectedCompany(enriched);

      // Subscribe to contacts for this company
      const unsubscribeContacts = customerService.subscribeToContacts(selectedCompanyId, (data) => {
        setEmployees(data);
      });

      // Subscribe to ticket history for this company
      const unsubscribeTickets = ticketService.subscribeToTicketsByCompany(selectedCompanyId, (data) => {
        setTicketHistory(data);
        setTicketHistoryMap(prev => ({ ...prev, [selectedCompanyId]: data }));
      });

      const orgId =
        (enriched as any)?.organizationId ||
        (enriched as any)?.organization_id ||
        null;
      const scopeIds = new Set<string>([selectedCompanyId]);
      if (orgId) scopeIds.add(String(orgId));
      const unsubscribeVault = vaultService.subscribeToHistory((items) => {
        const filtered = items.filter((item) => {
          const related = String(item.metadata?.relatedCompanyId || '');
          return related && scopeIds.has(related);
        });
        setCompanyVaultItems(filtered);
      });

      return () => {
        unsubscribeContacts();
        unsubscribeTickets();
        unsubscribeVault();
      };
    } else {
      setCompanyVaultItems([]);
    }
  }, [selectedCompanyId, companies, orgEnrichment]);

  // Enrich selected company from linked organization (contract + created_at).
  useEffect(() => {
    if (!selectedCompanyId) return;
    const base = companies.find((c) => c.id === selectedCompanyId);
    const orgId =
      (base as any)?.organizationId ||
      (base as any)?.organization_id ||
      null;
    if (!orgId) return;
    let cancelled = false;
    void axios
      .get(`/api/admin/organizations/${encodeURIComponent(String(orgId))}`, {
        withCredentials: true,
      })
      .then((res) => {
        if (cancelled) return;
        const org = res.data?.organization;
        if (!org) return;
        setOrgEnrichment((prev) => ({
          ...prev,
          [selectedCompanyId]: {
            organizationId: org.id,
            logoUrl: org.logo_url || (base as any)?.logoUrl || '',
            tier: org.tier || (base as any)?.tier || '',
            contractPlan: org.tier || (base as any)?.contractPlan || '',
            contractSla: org.sla || (base as any)?.contractSla || '',
            contractRenewalDate:
              org.contract_renewal || (base as any)?.contractRenewalDate || '',
            monthlySpend: org.monthly_rate || (base as any)?.monthlySpend || '',
            contractReference: org.contract_reference || '',
            contractNotes: org.contract_notes || '',
            contractTerm: org.contract_term || '',
            createdAtIso: org.created_at || '',
            hardware_returns_enabled: Boolean(
              org.hardware_returns_enabled || org.enabledModules?.hardwareReturns,
            ),
            customerSince: org.created_at
              ? new Date(org.created_at).toLocaleDateString('de-DE', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })
              : (base as any)?.customerSince || '',
          },
        }));
      })
      .catch(() => {
        /* keep CRM fields */
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, companies]);

  const slugifyCompany = (input: string) =>
    String(input || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);

  // Submit edits back to firebase + mirror core fields onto linked organization
  const handleEditCompanySubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCompanyId) return;
    setIsSaving(true);
    try {
      const slug =
        (editCompanyData as any).slug ||
        slugifyCompany(String(editCompanyData.name || ''));
      await customerService.updateCompany(selectedCompanyId, {
        ...editCompanyData,
        slug,
        updatedAt: new Date()
      } as any);

      const orgId =
        (editCompanyData as any).organizationId ||
        (editCompanyData as any).organization_id ||
        selectedCompany?.organizationId ||
        selectedCompany?.organization_id;
      if (orgId) {
        try {
          await axios.put(
            `/api/admin/organizations/${encodeURIComponent(String(orgId))}`,
            {
              name: editCompanyData.name,
              slug,
              domain: editCompanyData.domain || null,
              website: editCompanyData.website || null,
              industry: editCompanyData.branche || null,
              tier: (editCompanyData as any).tier || null,
              sla: (editCompanyData as any).contractSla || null,
              contract_renewal: (editCompanyData as any).contractRenewalDate || null,
              logo_url: editCompanyData.logoUrl || null,
            },
            { withCredentials: true },
          );
        } catch {
          /* CRM update already applied */
        }
      }

      setIsEditDialogOpen(false);
      toast.success("Support account metrics updated successfully!");
    } catch (error) {
      toast.error("Failed to update company information");
    } finally {
      setIsSaving(false);
    }
  };

  // Automated field helper for domain changes
  const handleDomainChange = (val: string) => {
    const dLower = val.toLowerCase().replace(/\s+/g, '');
    setNewCompany(prev => {
      const isAutoFilled = !prev.website || prev.website.includes(prev.domain) || prev.website === "https://www." || prev.website === "";
      return {
        ...prev,
        domain: dLower,
        website: isAutoFilled && dLower ? `https://www.${dLower}` : prev.website
      };
    });
  };

  /**
   * Smart Enrichment — only after an admin enters a domain and clicks Enrich.
   * Results are suggestions for review; they are not saved until Create.
   * Does not invent account managers or Hubcom staff.
   */
  const handleSmartEnrich = () => {
    if (!newCompany.domain) {
      toast.error(t('companies.enrich.needDomain', 'Bitte zuerst eine Domain eingeben.'));
      return;
    }
    setIsEnriching(true);
    const toastId = toast.loading(
      t('companies.enrich.loading', 'Anreicherungsvorschläge werden geladen…'),
    );

    setTimeout(() => {
      const dLower = newCompany.domain.toLowerCase().trim();
      const prefix = dLower.split('.')[0] || 'company';
      const capName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
      // Conservative suggestion from domain only — admin must review before save.
      const suggestion: Partial<NewCompanyFormState> = {
        name: newCompany.name.trim() ? newCompany.name : `${capName}`,
        website: newCompany.website.trim()
          ? newCompany.website
          : `https://www.${dLower}`,
        logoUrl: newCompany.logoUrl.trim()
          ? newCompany.logoUrl
          : `https://logo.clearbit.com/${dLower}`,
      };

      setNewCompany((prev) => ({ ...prev, ...suggestion }));
      setEnrichmentApplied(true);
      toast.dismiss(toastId);
      toast.message(
        t(
          'companies.enrich.review',
          'Vorschläge eingefügt — bitte prüfen und bei Bedarf korrigieren, bevor Sie speichern.',
        ),
      );
      setIsEnriching(false);
    }, 400);
  };

  // Logo file drag operations — PNG / JPEG / WebP ≤ 512 KB (matches backend policy)
  const handleLogoFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = String(e.target?.result || '');
      const check = parseAndValidateLogoDataUrl(dataUrl);
      if (check.ok === false) {
        toast.error(check.error);
        return;
      }
      setNewCompany((prev) => ({ ...prev, logoUrl: check.dataUrl }));
      toast.success(t('companies.logo.ready', 'Logo bereit — wird beim Speichern übernommen.'));
    };
    reader.readAsDataURL(file);
  };

  // Create company via canonical organizations API (also mirrors CRM company)
  const handleCreateCompany = async (e: FormEvent, isDraft = false) => {
    if (e) e.preventDefault();
    if (!newCompany.name || !newCompany.domain) {
      toast.error(t('companies.create.required', 'Firmenname und Domain sind erforderlich.'));
      return;
    }
    if (!newCompany.accountOwnerId) {
      toast.error(
        t('companies.create.needOwner', 'Bitte einen Account Manager aus der Mitarbeiterliste wählen.'),
      );
      return;
    }
    let logoUrl = newCompany.logoUrl.trim() || null;
    if (logoUrl && logoUrl.startsWith('data:')) {
      const check = parseAndValidateLogoDataUrl(logoUrl);
      if (check.ok === false) {
        toast.error(check.error);
        return;
      }
      logoUrl = check.dataUrl;
    }
    setIsSaving(true);
    try {
      const slug = newCompany.slug?.trim() || slugifyCompany(newCompany.name);
      const orgRes = await axios.post(
        '/api/admin/organizations',
        {
          name: newCompany.name.trim(),
          slug,
          domain: newCompany.domain.trim().toLowerCase(),
          website: newCompany.website || null,
          industry: newCompany.branche || null,
          tier: newCompany.tier || null,
          sla: newCompany.contractSla || null,
          contract_renewal: newCompany.contractRenewalDate || null,
          logo_url: logoUrl,
          is_active: !isDraft,
          settings: {},
        },
        { withCredentials: true },
      );
      const organization = orgRes.data?.organization;
      const companyId = String(organization?.crm_company_id || '');
      if (!companyId) {
        throw new Error('Organization created without CRM company link');
      }

      const owner = staffOwners.find((s) => s.id === newCompany.accountOwnerId);
      await customerService.updateCompany(companyId, {
        name: newCompany.name.trim(),
        slug,
        domain: newCompany.domain.trim().toLowerCase(),
        website: newCompany.website || '',
        logoUrl: logoUrl || organization?.logo_url || '',
        logo_url: logoUrl || organization?.logo_url || '',
        branche: newCompany.branche || '',
        companySize: newCompany.companySize || '',
        tier: newCompany.tier || '',
        country: newCompany.country || '',
        timezone: newCompany.timezone || '',
        address: newCompany.address || '',
        accountOwner: owner?.name || newCompany.accountOwner || '',
        accountOwnerId: newCompany.accountOwnerId,
        internalNotes: newCompany.internalNotes || '',
        wartungsvertragStatus: newCompany.wartungsvertragStatus || '',
        contractPlan: newCompany.contractPlan || '',
        contractSla: newCompany.contractSla || '',
        contractRenewalDate: newCompany.contractRenewalDate || '',
        organizationId: organization.id,
        organization_id: organization.id,
        phoneNumbers: newCompany.primaryContactPhone ? [newCompany.primaryContactPhone] : [],
        isDraft: isDraft,
        updatedAt: new Date(),
      } as any);

      // Create contact if specified
      if (newCompany.primaryContactName && newCompany.primaryContactEmail) {
        try {
          await customerService.createContact({
            companyId: companyId,
            name: newCompany.primaryContactName,
            email: newCompany.primaryContactEmail,
            title: newCompany.primaryContactTitle || 'Primary Contact',
            phoneWork: newCompany.primaryContactPhone || '',
            phoneMobile: '',
            address: newCompany.address || '',
            metadata: {
              role: 'primary_contact',
              enriched: enrichmentApplied,
            },
          });
        } catch (contactErr) {
          console.warn('Failed to create associated contact record', contactErr);
        }
      }

      setIsCreateDialogOpen(false);
      setSelectedCompanyId(companyId);
      setEnrichmentApplied(false);

      if (isDraft) {
        toast.success(t('companies.create.draftSaved', 'Entwurf gespeichert.'));
      } else {
        toast.success(t('companies.create.success', 'Unternehmen erfolgreich angelegt.'));
      }

      setNewCompany(blankNewCompanyForm());
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error ||
          (isDraft
            ? t('companies.create.draftFailed', 'Entwurf konnte nicht gespeichert werden.')
            : t('companies.create.failed', 'Unternehmen konnte nicht angelegt werden.')),
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Create new contact
  const handleCreateContact = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCompanyId) return;
    if (!newContact.name || !newContact.email) {
      toast.error("Name and email are required");
      return;
    }
    setIsSaving(true);
    try {
      await customerService.createContact({
        ...newContact,
        companyId: selectedCompanyId,
      });
      setIsContactDialogOpen(false);
      toast.success("Direct contact added to organization!");
      setNewContact({
        name: '',
        email: '',
        title: '',
        phoneWork: '',
        phoneMobile: '',
        metadata: {}
      });
    } catch (error) {
      toast.error("Failed to add contact");
    } finally {
      setIsSaving(false);
    }
  };

  // Format active hydrated company details
  const hydratedCompany = hydrateCompany(selectedCompany, ticketHistory);
  const hardwareReturnsEnabled = Boolean(
    (hydratedCompany as any)?.hardware_returns_enabled,
  );
  const selectedOrgId =
    hydratedCompany?.organizationId ||
    (hydratedCompany as any)?.organization_id ||
    null;
  const selectedOrgMeta = selectedOrgId ? orgListMeta[String(selectedOrgId)] : undefined;
  const companyKpis = {
    ...buildCompanyKpiMetrics({
      contactsCount: employees.length,
      ticketHistory,
      assetsCount: 0,
      vaultEntriesCount: companyVaultItems.length,
      slaPerformance: null,
      monthlySpend: hydratedCompany?.monthlySpend || null,
    }),
    openReturnsCount: selectedOrgMeta?.open_returns_count ?? 0,
    contractStatusLabel: hydratedCompany?.hasContract
      ? hydratedCompany.contractStatus === 'ACTIVE'
        ? t('companies.active', 'Aktiv')
        : hydratedCompany.contractStatus === 'EXPIRED'
          ? t('companies.expired', 'Abgelaufen')
          : t('companies.supportContract', 'Support-Vertrag')
      : t('companies.noContractShort', 'Kein Vertrag'),
  };

  /** Merge org branding logos + counts onto CRM companies for the left list. */
  const companiesForSidebar = companies.map((c) => {
    const orgId =
      (c as any).organizationId || (c as any).organization_id || null;
    const meta = orgId ? orgListMeta[String(orgId)] : undefined;
    if (!meta) return c;
    return {
      ...c,
      logoUrl: meta.logo_url || (c as any).logoUrl || (c as any).logo_url || '',
      logo_url: meta.logo_url || (c as any).logo_url || null,
      openTicketsCountOverride: meta.open_tickets_count,
      openReturnsCountOverride: meta.open_returns_count,
    } as Company;
  });

  return (
    <div className="flex h-full bg-background overflow-hidden">
      
      {/* Sidebar: Intelligent Company Navigator */}
      <CompanySidebar 
        companies={companiesForSidebar}
        selectedCompanyId={selectedCompanyId}
        onSelectCompany={setSelectedCompanyId}
        favorites={favorites}
        onToggleFavorite={handleToggleFavorite}
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onAddCompanyClick={() => setIsCreateDialogOpen(true)}
        onImportClick={() => setIsImportOpen(true)}
        ticketHistoryMap={ticketHistoryMap}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapsed}
      />

      {/* Main View: Customer 360 Workspace Container */}
      <div className={cn(
        "flex-1 bg-muted/15 overflow-hidden flex-col min-h-0 transition-[width] duration-300 ease-out",
        // Mobile master-detail: hidden until a company is selected, then full width.
        selectedCompanyId ? "flex" : "hidden lg:flex"
      )}>
        {hydratedCompany ? (
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 sm:p-5 max-w-7xl mx-auto space-y-4">
              {/* Mobile-only back affordance to return to the company list. */}
              <button
                onClick={() => setSelectedCompanyId(null)}
                className="lg:hidden flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-foreground -mb-1"
              >
                <ChevronLeft className="w-4 h-4" /> {t('nav.companies', 'Unternehmen')}
              </button>
              
              <CompanyHeader 
                company={{
                  ...hydratedCompany,
                  logoUrl:
                    selectedOrgMeta?.logo_url ||
                    hydratedCompany.logoUrl ||
                    '',
                }}
                onEditCompanyClick={() => {
                  setEditCompanyData(hydratedCompany);
                  setIsEditDialogOpen(true);
                }}
                onViewContractClick={() => setActiveSubTab('overview')}
                onPortalClick={() => {
                  setPortalFocusInvite(false);
                  setActiveSubTab('portal');
                }}
                onInviteClientAdminClick={() => {
                  setPortalFocusInvite(true);
                  setActiveSubTab('portal');
                }}
                sidebarCollapsed={sidebarCollapsed}
                onExpandSidebar={toggleSidebarCollapsed}
                companies={companiesForSidebar}
                onSelectCompany={setSelectedCompanyId}
              />

              <CompanyKPI metrics={companyKpis} showReturns={hardwareReturnsEnabled} />

              {/* 6 primary tabs — wrap, never clip */}
              <div className="border-b border-muted">
                <Tabs
                  value={activeSubTab}
                  onValueChange={(val) => {
                    setActiveSubTab(val);
                    if (val !== 'portal') setPortalFocusInvite(false);
                  }}
                  className="w-full"
                >
                  <TabsList className="bg-transparent border-none p-0 h-auto flex flex-wrap gap-x-4 gap-y-1 select-none w-full max-w-full">
                    {[
                      { value: 'overview', label: t('nav.overview', 'Übersicht') },
                      {
                        value: 'portal',
                        label: t('companies.portalTab', 'Kunden-Portal'),
                        icon: Globe,
                      },
                      {
                        value: 'tickets',
                        label: t('nav.tickets', 'Tickets'),
                        count: ticketHistory.length,
                      },
                      ...(hardwareReturnsEnabled
                        ? [
                            {
                              value: 'returns',
                              label: t('companies.returnsTab', 'Rücklieferungen'),
                              count: companyKpis.openReturnsCount ?? 0,
                              icon: Package,
                            },
                          ]
                        : []),
                      {
                        value: 'assets-vault',
                        label: t('companies.assetsAndVault', 'Assets & Tresor'),
                        count:
                          (companyKpis.assetsCount ?? 0) +
                          (companyKpis.vaultEntriesCount ?? 0),
                      },
                      {
                        value: 'activity',
                        label: t('companies.activityTimeline', 'Verlauf'),
                      },
                    ].map(tab => {
                      const Icon = tab.icon;
                      return (
                        <TabsTrigger
                          key={tab.value}
                          value={tab.value}
                          className="px-1.5 py-2 text-xs font-bold bg-transparent border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary text-muted-foreground hover:text-foreground hover:border-muted-foreground/30 rounded-none transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                        >
                          {Icon && <Icon className="w-3.5 h-3.5 text-indigo-500" />}
                          <span>{tab.label}</span>
                          {tab.count !== undefined && (
                            <span className="text-[10px] scale-90 px-1 bg-muted text-muted-foreground rounded-full border border-muted-foreground/10 shrink-0 font-extrabold font-mono">
                              {tab.count}
                            </span>
                          )}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </Tabs>
              </div>

              {/* Tab views body */}
              {activeSubTab === 'overview' ? (
                <CompanyOverviewTab 
                  company={hydratedCompany}
                  ticketHistory={ticketHistory}
                  vaultItems={companyVaultItems}
                  onTabChange={(tab) => {
                    if (tab === 'vault' || tab === 'assets') {
                      setActiveSubTab('assets-vault');
                      return;
                    }
                    if (tab === 'contracts' || tab === 'contacts' || tab === 'insights') {
                      setActiveSubTab('overview');
                      return;
                    }
                    setActiveSubTab(tab);
                  }}
                  onOpenVaultClick={() => setActiveSubTab('assets-vault')}
                  onViewAllTicketsClick={() => setActiveSubTab('tickets')}
                />
              ) : activeSubTab === 'portal' ? (
                <CompanyPortalTab
                  organizationId={
                    hydratedCompany.organizationId ||
                    (hydratedCompany as any).organization_id ||
                    null
                  }
                  companyName={hydratedCompany.name}
                  focusInvite={portalFocusInvite}
                  onOpenEmailConfig={() => navigate('/admin/email-channels')}
                />
              ) : activeSubTab === 'returns' && hardwareReturnsEnabled ? (
                <CompanyReturnsTab
                  organizationId={
                    hydratedCompany.organizationId ||
                    (hydratedCompany as any).organization_id ||
                    null
                  }
                />
              ) : activeSubTab === 'assets-vault' ? (
                <div className="space-y-8">
                  <CompanyOtherTabs
                    activeSubTab="assets"
                    company={hydratedCompany}
                    employees={employees}
                    contactSchema={contactSchema}
                    ticketHistory={ticketHistory}
                    onAddContactClick={() => setIsContactDialogOpen(true)}
                    onSelectTicket={(ticketId) => navigate(`/tickets/${ticketId}`)}
                    onVaultItemsChange={setCompanyVaultItems}
                  />
                  <CompanyOtherTabs
                    activeSubTab="vault"
                    company={hydratedCompany}
                    employees={employees}
                    contactSchema={contactSchema}
                    ticketHistory={ticketHistory}
                    onAddContactClick={() => setIsContactDialogOpen(true)}
                    onSelectTicket={(ticketId) => navigate(`/tickets/${ticketId}`)}
                    onVaultItemsChange={setCompanyVaultItems}
                    onContactsChanged={() => {
                      if (!selectedCompanyId) return;
                      setOrgEnrichment((prev) => ({ ...prev }));
                    }}
                    onCompanyUpdated={(patch) => {
                      if (!selectedCompanyId) return;
                      setOrgEnrichment((prev) => ({
                        ...prev,
                        [selectedCompanyId]: {
                          ...(prev[selectedCompanyId] || {}),
                          ...patch,
                        },
                      }));
                    }}
                  />
                </div>
              ) : (
                <CompanyOtherTabs 
                  activeSubTab={activeSubTab}
                  company={hydratedCompany}
                  employees={employees}
                  contactSchema={contactSchema}
                  ticketHistory={ticketHistory}
                  onAddContactClick={() => setIsContactDialogOpen(true)}
                  onSelectTicket={(ticketId) => navigate(`/tickets/${ticketId}`)}
                  onVaultItemsChange={setCompanyVaultItems}
                  onContactsChanged={() => {
                    if (!selectedCompanyId) return;
                    setOrgEnrichment((prev) => ({ ...prev }));
                  }}
                  onCompanyUpdated={(patch) => {
                    if (!selectedCompanyId) return;
                    setOrgEnrichment((prev) => ({
                      ...prev,
                      [selectedCompanyId]: {
                        ...(prev[selectedCompanyId] || {}),
                        ...patch,
                      },
                    }));
                  }}
                />
              )}

            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-muted/5">
             <div className="w-24 h-24 bg-background rounded-full border border-dashed border-primary/20 flex flex-col items-center justify-center mb-6 shadow-xs relative">
                <Building2 className="w-9 h-9 text-muted-foreground/30" />
                <Sparkles className="w-4 h-4 text-primary absolute top-5 right-5 animate-pulse" />
             </div>
             <h2 className="text-xl font-extrabold text-foreground tracking-tight">
               {companies.length === 0
                 ? t('companies.emptyWorkspace', 'Noch keine Unternehmen')
                 : t('companies.selectCompany', 'Unternehmen auswählen')}
             </h2>
             <p className="text-muted-foreground max-w-sm mt-2 text-xs font-semibold leading-relaxed">
               {companies.length === 0 
                 ? t(
                     'companies.emptyWorkspaceHint',
                     'Legen Sie ein Unternehmen manuell an oder importieren Sie eine CSV-Datei.',
                   )
                 : t(
                     'companies.selectCompanyHint',
                     'Wählen Sie links ein Unternehmen, um Tickets, Kontakte, Tresor und Branding zu öffnen.',
                   )}
             </p>
             {companies.length === 0 && (
               <Button 
                 onClick={() => setIsCreateDialogOpen(true)}
                 className="mt-8 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl px-6 h-11 text-xs shadow-md gap-2 cursor-pointer transition-all"
               >
                 <Plus className="w-4 h-4" />
                 {t('companies.createCompany', 'Unternehmen anlegen')}
               </Button>
             )}
          </div>
        )}
      </div>

      <CSVImporter 
        open={isImportOpen} 
        onOpenChange={setIsImportOpen} 
        onComplete={() => {}} 
      />

      {/* CREATE DIALOG MODAL */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-[1040px] md:max-w-[1100px] w-[95vw] h-[85vh] max-h-[85vh] rounded-[24px] p-0 border border-slate-200 bg-[#F8F9FA] overflow-hidden flex flex-col shadow-2xl">
          {/* Header */}
          <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 text-[#1A73E8] rounded-xl shrink-0">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-slate-900 tracking-tight leading-none">
                  Register New Company
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 font-medium mt-1 leading-none">
                  Create a Company 360 profile for customer management.
                </DialogDescription>
              </div>
            </div>
          </div>

          <form onSubmit={(e) => handleCreateCompany(e, false)} className="flex-1 flex flex-col overflow-hidden">
            {/* Split Column Panel */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden min-h-0 bg-[#F8F9FA]">
              
              {/* Left Column: Logo Drag-and-Drop & Enrichment Sidebar */}
              <div className="w-full lg:w-[250px] border-b lg:border-b-0 lg:border-r border-slate-200/60 bg-white p-5 flex flex-col gap-5 lg:shrink-0 overflow-y-auto">
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Company Profile</h3>
                  <div 
                    onDragOver={(e) => { e.preventDefault(); setDraggingFile(true); }}
                    onDragLeave={() => setDraggingFile(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDraggingFile(false);
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        handleLogoFile(e.dataTransfer.files[0]);
                      }
                    }}
                    onClick={() => document.getElementById('company-logo-input')?.click()}
                    className={cn(
                      "border-2 border-dashed rounded-2xl p-4 text-center flex flex-col items-center justify-center cursor-pointer transition-all h-[170px]",
                      draggingFile ? "border-primary bg-primary/5" : "border-[#DADCE0] hover:border-slate-400 bg-slate-50/40"
                    )}
                  >
                    <input 
                      id="company-logo-input"
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleLogoFile(e.target.files[0]);
                        }
                      }}
                    />
                    {newCompany.logoUrl ? (
                      <div className="relative group w-full h-full flex items-center justify-center">
                        <img src={newCompany.logoUrl} alt="Logo" className="max-h-[130px] max-w-[150px] object-contain rounded-xl" />
                        <div className="absolute inset-0 bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                          <span className="text-[10px] text-white font-bold bg-primary px-2.5 py-1 rounded-full">Change</span>
                          <button 
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setNewCompany(prev => ({ ...prev, logoUrl: '' }));
                            }}
                            className="p-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="p-3 bg-white text-slate-400 rounded-xl inline-block mx-auto shadow-sm border border-slate-100">
                          <Building className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-[11px] font-black text-slate-800 leading-none">Drag & drop logo here</p>
                          <p className="text-[10px] text-slate-400 font-bold mt-1 leading-none">or click to upload</p>
                        </div>
                        <p className="text-[9px] text-slate-400 font-medium pt-1">PNG, JPG, SVG up to 2MB</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Automation & Enrichment panel */}
                <div className="border border-blue-100 bg-blue-50/50 rounded-2xl p-4 space-y-2.5 mt-auto">
                  <div className="flex gap-2 text-blue-700">
                    <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
                    <span className="text-[11px] font-bold uppercase tracking-wider">Smart Enrichment</span>
                  </div>
                  <p className="text-[10px] text-blue-600/80 font-semibold leading-relaxed">
                    Enter a domain and we'll automatically find company details, logo, industry and more.
                  </p>
                  <Button
                    type="button"
                    onClick={handleSmartEnrich}
                    disabled={isEnriching || !newCompany.domain}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold rounded-xl h-8.5 text-[10px] gap-1 shadow-sm shrink-0 cursor-pointer transition-all mt-1"
                  >
                    {isEnriching ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    Enrich Domain
                  </Button>
                </div>
              </div>

              {/* Middle Column: Scrollable Forms */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                
                {/* Card 1: Company Information */}
                <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-50 pb-2 text-[#1A73E8]">
                    <Building className="w-4 h-4" />
                    <h4 className="text-xs font-bold uppercase tracking-wider">Company Information</h4>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5 col-span-2">
                      <Label htmlFor="name" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Name <span className="text-red-500">*</span>
                      </Label>
                      <Input 
                        id="name" 
                        required
                        placeholder="z. B. Firmenname" 
                        value={newCompany.name}
                        onChange={(e) => {
                          const name = e.target.value;
                          setNewCompany((prev) => ({
                            ...prev,
                            name,
                            slug:
                              !prev.slug || prev.slug === slugifyCompany(prev.name)
                                ? slugifyCompany(name)
                                : prev.slug,
                          }));
                        }}
                        className="rounded-xl border border-slate-200 h-10 font-semibold text-slate-800 text-xs focus-visible:ring-primary"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="slug" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Slug <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="slug"
                        required
                        placeholder="acme-global"
                        value={newCompany.slug}
                        onChange={(e) =>
                          setNewCompany({
                            ...newCompany,
                            slug: e.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9-]+/g, '-')
                              .replace(/^-+|-+$/g, ''),
                          })
                        }
                        className="rounded-xl border border-slate-200 h-10 font-semibold text-slate-800 text-xs focus-visible:ring-primary font-mono"
                      />
                      <p className="text-[9px] text-slate-400 font-semibold mt-1">
                        Portal-Tenant-Kennung (eindeutig)
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="domain" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Domain <span className="text-red-500">*</span>
                      </Label>
                      <div className="relative">
                        <Input 
                          id="domain" 
                          required
                          placeholder="acme.com" 
                          value={newCompany.domain}
                          onChange={(e) => handleDomainChange(e.target.value)}
                          className="rounded-xl border border-slate-200 h-10 pr-8 font-semibold text-slate-800 text-xs focus-visible:ring-primary"
                        />
                        {newCompany.domain && (
                          <div className="absolute right-2.5 top-2.5 text-emerald-500" title="Validating domain">
                            <Check className="w-4 h-4 stroke-[3px]" />
                          </div>
                        )}
                      </div>
                      <p className="text-[9px] text-slate-400 font-semibold mt-1">Company domain for auto-enrichment</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="website" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Website URL
                      </Label>
                      <Input 
                        id="website" 
                        placeholder="https://www.acme.com" 
                        value={newCompany.website}
                        onChange={(e) => setNewCompany({...newCompany, website: e.target.value})}
                        className="rounded-xl border border-slate-200 h-10 font-semibold text-slate-800 text-xs focus-visible:ring-primary"
                      />
                      <p className="text-[9px] text-slate-400 font-semibold mt-1">Auto-filled from domain</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Industry Sector</Label>
                      <Select 
                        value={newCompany.branche || undefined} 
                        onValueChange={(val) => setNewCompany({...newCompany, branche: val as any})}
                      >
                        <SelectTrigger className="rounded-xl border border-slate-200 h-10 font-semibold text-slate-700 text-xs bg-white">
                          <SelectValue placeholder="Select industry" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl shadow-lg border-slate-100">
                          {BRANCHES.map(branch => (
                            <SelectItem key={branch} value={branch} className="rounded-lg font-semibold text-xs py-2">{branch}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Company Size</Label>
                      <Select 
                        value={newCompany.companySize || undefined} 
                        onValueChange={(val) => setNewCompany({...newCompany, companySize: val})}
                      >
                        <SelectTrigger className="rounded-xl border border-slate-200 h-10 font-semibold text-slate-700 text-xs bg-white">
                          <SelectValue placeholder="Select size" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl shadow-lg border-slate-100">
                          {['1–10', '11–50', '51–200', '201–500', '501–1000', '1000+'].map(size => (
                            <SelectItem key={size} value={size} className="rounded-lg font-semibold text-xs py-2">{size} employees</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5 col-span-2">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Customer Tier</Label>
                      <Select 
                        value={newCompany.tier || undefined} 
                        onValueChange={(val) => setNewCompany({...newCompany, tier: val})}
                      >
                        <SelectTrigger className="rounded-xl border border-slate-200 h-10 font-black text-slate-800 text-xs bg-white">
                          <SelectValue placeholder="Select customer tier" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl shadow-lg border-slate-100">
                          <SelectItem value="Enterprise" className="rounded-lg font-bold text-xs py-2 text-amber-600 bg-amber-50/10">⭐ Enterprise Premium</SelectItem>
                          <SelectItem value="Pro" className="rounded-lg font-bold text-xs py-2 text-blue-600">⚡ Pro Growth</SelectItem>
                          <SelectItem value="Standard" className="rounded-lg font-bold text-xs py-2 text-slate-600">👤 Standard Account</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Card 2: Contact Information */}
                <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-50 pb-2 text-[#1A73E8]">
                    <User className="w-4 h-4" />
                    <h4 className="text-xs font-bold uppercase tracking-wider">Contact Information</h4>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="contactName" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Primary Contact Name</Label>
                      <Input
                        id="contactName"
                        placeholder="John Smith"
                        value={newCompany.primaryContactName}
                        onChange={(e) => setNewCompany({...newCompany, primaryContactName: e.target.value})}
                        className="rounded-xl border border-slate-200 h-10 font-semibold text-slate-800 text-xs focus-visible:ring-primary"
                      />
                      <p className="text-[9px] text-slate-400 font-semibold mt-1">Main point of contact</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="contactEmail" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Email Address</Label>
                      <Input
                        id="contactEmail"
                        type="email"
                        placeholder="john.smith@acme.com"
                        value={newCompany.primaryContactEmail}
                        onChange={(e) => setNewCompany({...newCompany, primaryContactEmail: e.target.value})}
                        className="rounded-xl border border-slate-200 h-10 font-semibold text-slate-800 text-xs focus-visible:ring-primary"
                      />
                      <p className="text-[9px] text-slate-400 font-semibold mt-1">Business email address</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="contactPhone" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Phone Number</Label>
                      <Input
                        id="contactPhone"
                        placeholder="+49 123 456 7890"
                        value={newCompany.primaryContactPhone}
                        onChange={(e) => setNewCompany({...newCompany, primaryContactPhone: e.target.value})}
                        className="rounded-xl border border-slate-200 h-10 font-semibold text-slate-800 text-xs focus-visible:ring-primary"
                      />
                      <p className="text-[9px] text-slate-400 font-semibold mt-1">Include country code</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="contactTitle" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Job Title</Label>
                      <Input
                        id="contactTitle"
                        placeholder="IT Director"
                        value={newCompany.primaryContactTitle}
                        onChange={(e) => setNewCompany({...newCompany, primaryContactTitle: e.target.value})}
                        className="rounded-xl border border-slate-200 h-10 font-semibold text-slate-800 text-xs focus-visible:ring-primary"
                      />
                      <p className="text-[9px] text-slate-400 font-semibold mt-1">Contact's job title</p>
                    </div>
                  </div>
                </div>

                {/* Card 3: Business Details */}
                <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-50 pb-2 text-[#1A73E8]">
                    <MapPin className="w-4 h-4" />
                    <h4 className="text-xs font-bold uppercase tracking-wider">Business Details</h4>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Country</Label>
                      <Select
                        value={newCompany.country || undefined}
                        onValueChange={(val) => setNewCompany({...newCompany, country: val})}
                      >
                        <SelectTrigger className="rounded-xl border border-slate-200 h-10 font-semibold text-slate-700 text-xs bg-white">
                          <SelectValue placeholder="Select country" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl shadow-lg border-slate-100">
                          {['Germany', 'United States', 'United Kingdom', 'Switzerland', 'Austria', 'France', 'Other'].map(country => (
                            <SelectItem key={country} value={country} className="rounded-lg font-semibold text-xs py-2">{country}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Timezone</Label>
                      <Select
                        value={newCompany.timezone || undefined}
                        onValueChange={(val) => setNewCompany({...newCompany, timezone: val})}
                      >
                        <SelectTrigger className="rounded-xl border border-slate-200 h-10 font-semibold text-slate-700 text-xs bg-white">
                          <SelectValue placeholder="Select timezone" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl shadow-lg border-slate-100">
                          {['Europe/Berlin (GMT+2)', 'US/Pacific (GMT-8)', 'US/Eastern (GMT-5)', 'Europe/London (GMT+1)', 'Asia/Tokyo (GMT+9)', 'Other'].map(tz => (
                            <SelectItem key={tz} value={tz} className="rounded-lg font-semibold text-xs py-2">{tz}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[9px] text-slate-400 font-semibold mt-1">Auto-detected</p>
                    </div>

                    <div className="space-y-1.5 col-span-2">
                      <Label htmlFor="address" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Physical Address</Label>
                      <Textarea
                        id="address"
                        placeholder="Friedrichstraße 123, 10117 Berlin, Germany"
                        value={newCompany.address}
                        onChange={(e) => setNewCompany({...newCompany, address: e.target.value})}
                        className="rounded-xl border border-slate-200 min-h-[60px] font-semibold text-slate-800 text-xs focus-visible:ring-primary resize-none p-3"
                      />
                    </div>
                  </div>
                </div>

                {/* Card 4: Internal Information */}
                <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-50 pb-2 text-[#1A73E8]">
                    <Shield className="w-4 h-4" />
                    <h4 className="text-xs font-bold uppercase tracking-wider">Internal Information</h4>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5 col-span-2">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        {t('companies.form.accountManager', 'Account Manager')}
                      </Label>
                      <Select
                        value={newCompany.accountOwnerId || undefined}
                        onValueChange={(val) => {
                          const owner = staffOwners.find((s) => s.id === val);
                          setNewCompany({
                            ...newCompany,
                            accountOwnerId: val,
                            accountOwner: owner?.name || '',
                          });
                        }}
                      >
                        <SelectTrigger className="rounded-xl border border-slate-200 h-10 font-semibold text-slate-700 text-xs bg-white">
                          <SelectValue
                            placeholder={t(
                              'companies.form.selectAccountManager',
                              'Mitarbeiter wählen…',
                            )}
                          />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl shadow-lg border-slate-100">
                          {staffOwners.length === 0 ? (
                            <SelectItem value="__none" disabled>
                              {t(
                                'companies.form.noStaff',
                                'Keine Hubcom-Mitarbeiter geladen',
                              )}
                            </SelectItem>
                          ) : (
                            staffOwners.map((owner) => (
                              <SelectItem
                                key={owner.id}
                                value={owner.id}
                                className="rounded-lg font-semibold text-xs py-2"
                              >
                                {owner.name}
                                {owner.email ? ` · ${owner.email}` : ''}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <p className="text-[9px] text-slate-400 font-semibold mt-1">
                        {t(
                          'companies.form.accountManagerHint',
                          'Nur aktive Hubcom-Mitarbeiter — keine Portal-Kunden.',
                        )}
                      </p>
                    </div>

                    <div className="space-y-1.5 col-span-2">
                      <Label htmlFor="internalNotes" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Internal Notes</Label>
                      <Textarea
                        id="internalNotes"
                        placeholder="Notes regarding organization structure, managed devices, etc."
                        value={newCompany.internalNotes}
                        onChange={(e) => setNewCompany({...newCompany, internalNotes: e.target.value})}
                        className="rounded-xl border border-slate-200 min-h-[70px] font-semibold text-slate-800 text-xs focus-visible:ring-primary resize-none p-3"
                      />
                      <p className="text-[9px] text-slate-400 font-semibold mt-1">Only visible to internal users</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Live Company Preview */}
              <div className="w-full lg:w-[330px] border-t lg:border-t-0 lg:border-l border-slate-200/60 bg-white p-5 flex flex-col gap-4 lg:shrink-0 overflow-y-auto">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Company Preview</span>
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 select-none animate-pulse">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                    Live Preview
                  </span>
                </div>

                {/* Identity Preview Group */}
                <div className="bg-[#F8F9FA]/80 border border-slate-100 rounded-2xl p-4 space-y-4">
                  <div className="flex items-center gap-3.5">
                    {newCompany.logoUrl ? (
                      <div className="w-13 h-13 rounded-2xl border border-slate-100 bg-white flex items-center justify-center p-1.5 shrink-0 shadow-sm">
                        <img src={newCompany.logoUrl} alt="Logo" className="w-full h-full object-contain rounded-xl" />
                      </div>
                    ) : (
                      <div className="w-13 h-13 rounded-2xl bg-blue-600 text-white flex items-center justify-center p-2 shadow-md shadow-blue-600/10 shrink-0 font-bold text-lg select-none">
                        {newCompany.name ? newCompany.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() : <Building className="w-5 h-5" />}
                      </div>
                    )}
                    <div className="min-w-0">
                      <h4 className="text-sm font-black text-slate-900 truncate leading-tight tracking-tight">
                        {newCompany.name ||
                          t('companies.preview.unnamed', 'Neues Unternehmen')}
                      </h4>
                      {newCompany.domain && (
                        <a 
                          href={`https://${newCompany.domain}`} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="text-[#1A73E8] hover:underline text-[10.5px] font-bold flex items-center gap-0.5 mt-1 truncate"
                        >
                          {newCompany.domain} <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                        </a>
                      )}
                      
                      <span className="text-[10px] text-slate-500 font-semibold flex items-center gap-1 mt-1.5 truncate">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                        {newCompany.country || "Germany"}
                      </span>
                    </div>
                  </div>

                  {/* Specification Table */}
                  <div className="border-t border-slate-200/50 pt-3.5 space-y-2.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2 text-slate-500 font-semibold">
                        <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                        <span>Industry</span>
                      </div>
                      <span className="font-bold text-slate-800">
                        {newCompany.branche || '—'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2 text-slate-500 font-semibold">
                        <Users className="w-3.5 h-3.5 text-slate-400" />
                        <span>Company Size</span>
                      </div>
                      <span className="font-bold text-slate-800">
                        {newCompany.companySize || '—'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2 text-slate-500 font-semibold">
                        <Layers className="w-3.5 h-3.5 text-slate-400" />
                        <span>Tier Level</span>
                      </div>
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                        newCompany.tier === 'Enterprise' ? "text-amber-700 bg-amber-50 border-amber-200" :
                        newCompany.tier === 'Pro' ? "text-blue-700 bg-blue-50 border-blue-200" :
                        "text-slate-700 bg-slate-50 border-slate-200"
                      )}>
                        {newCompany.tier || '—'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2 text-slate-500 font-semibold">
                        <Globe className="w-3.5 h-3.5 text-slate-400" />
                        <span>Website</span>
                      </div>
                      <span className="font-bold text-slate-800 max-w-[140px] truncate" title={newCompany.website}>
                        {newCompany.website
                          ? newCompany.website.replace(/^https?:\/\//, '')
                          : '—'}
                      </span>
                    </div>
                  </div>
                  {enrichmentApplied ? (
                    <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                      {t(
                        'companies.preview.enrichmentBanner',
                        'Enriched suggestion — not saved until you create the company.',
                      )}
                    </p>
                  ) : null}
                </div>

                {/* Primary Contact Group */}
                <div className="space-y-2">
                  <span className="text-[10.5px] font-black text-slate-400 uppercase tracking-widest leading-none">Primary Contact</span>
                  <div className="border border-slate-100 rounded-2xl p-3.5 bg-slate-50/50 flex flex-col gap-2.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8.5 h-8.5 rounded-full bg-slate-200/80 text-slate-600 font-bold text-xs flex items-center justify-center select-none uppercase shadow-inner">
                        {newCompany.primaryContactName
                          ? newCompany.primaryContactName
                              .split(' ')
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join('')
                          : '—'}
                      </div>
                      <div className="min-w-0">
                        <h5 className="text-xs font-black text-slate-800 tracking-tight leading-tight truncate">
                          {newCompany.primaryContactName || '—'}
                        </h5>
                        <p className="text-[10px] text-slate-500 font-bold leading-tight truncate mt-0.5">
                          {newCompany.primaryContactTitle || '—'}
                        </p>
                      </div>
                    </div>

                    <div className="border-t border-slate-100 pt-2 space-y-1 text-[10px] text-slate-500 font-semibold leading-relaxed">
                      <div className="flex items-center gap-2 truncate">
                        <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>{newCompany.primaryContactEmail || '—'}</span>
                      </div>
                      <div className="flex items-center gap-2 truncate mt-1">
                        <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>{newCompany.primaryContactPhone || '—'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Assigned Account owner Preview */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Account Manager</span>
                  <div className="flex items-center gap-2.5 px-1 py-1">
                    <div className="w-7 h-7 rounded-full bg-[#1A73E8]/10 text-primary text-[11px] font-bold flex items-center justify-center select-none uppercase shadow-inner border border-[#1A73E8]/5">
                      {newCompany.accountOwner
                        ? newCompany.accountOwner
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                        : '—'}
                    </div>
                    <span className="text-xs font-bold text-slate-700">
                      {newCompany.accountOwner ||
                        t('companies.preview.noOwner', 'Nicht zugewiesen')}
                    </span>
                  </div>
                </div>

                {/* Quick status preview */}
                <div className="mt-auto border-t border-slate-100 pt-3 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400 font-semibold">Account Status</span>
                  <span className="font-bold text-emerald-600 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-ping"></span>
                    Active Account
                  </span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-50 border-t border-slate-200/60 px-6 py-4 flex items-center justify-between shrink-0">
              <Button 
                type="button" 
                variant="ghost" 
                onClick={() => setIsCreateDialogOpen(false)}
                className="rounded-xl font-bold h-10 px-5 text-xs text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </Button>

              <div className="hidden md:flex items-center gap-1.5 text-slate-400 select-none">
                <Lock className="w-3 h-3" />
                <span className="text-[9.5px] font-bold uppercase tracking-wider">Zero-Knowledge Encrypted Architecture</span>
              </div>

              <div className="flex items-center gap-2">
                <Button 
                  type="button" 
                  variant="outline"
                  onClick={(e) => handleCreateCompany(e as any, true)}
                  disabled={isSaving}
                  className="rounded-xl border border-slate-200 font-bold h-10 px-5 text-xs text-slate-700 bg-white hover:bg-slate-50"
                >
                  Save Draft
                </Button>
                <Button 
                  type="submit" 
                  disabled={isSaving}
                  className="bg-primary hover:bg-primary/95 text-white font-extrabold rounded-xl px-5 h-10 text-xs shadow-md shadow-primary/10 gap-1.5 cursor-pointer transition-all"
                >
                  {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Create Company
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT MODAL DIALOG */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[550px] rounded-[24px] p-6 border border-muted-foreground/10 overflow-hidden bg-background max-h-[90vh] overflow-y-auto">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-xl font-extrabold tracking-tight flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-xl text-primary shrink-0">
                <Edit3 className="w-5 h-5" />
              </div>
              Edit support profile: {editCompanyData.name}
            </DialogTitle>
            <DialogDescription className="text-xs font-semibold text-muted-foreground leading-relaxed">
              Manage contract SLAs, support tiers, and simulate organization health scores.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditCompanySubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs text-foreground font-semibold">
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="edit-name" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Name</Label>
                <Input 
                  id="edit-name" 
                  value={editCompanyData.name || ''}
                  onChange={(e) => setEditCompanyData({...editCompanyData, name: e.target.value})}
                  className="rounded-xl border border-muted-foreground/15 h-10 font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-slug" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Slug</Label>
                <Input
                  id="edit-slug"
                  value={(editCompanyData as any).slug || ''}
                  onChange={(e) =>
                    setEditCompanyData({
                      ...editCompanyData,
                      slug: e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]+/g, '-')
                        .replace(/^-+|-+$/g, ''),
                    } as any)
                  }
                  className="rounded-xl border border-muted-foreground/15 h-10 font-semibold font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-domain" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Domain</Label>
                <Input 
                  id="edit-domain" 
                  value={editCompanyData.domain || ''}
                  onChange={(e) => setEditCompanyData({...editCompanyData, domain: e.target.value})}
                  className="rounded-xl border border-muted-foreground/15 h-10 font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-website" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Website URL</Label>
                <Input 
                  id="edit-website" 
                  value={editCompanyData.website || ''}
                  onChange={(e) => setEditCompanyData({...editCompanyData, website: e.target.value})}
                  className="rounded-xl border border-muted-foreground/15 h-10 font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-branch" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sector Industry</Label>
                <Select 
                  value={editCompanyData.branche || ''} 
                  onValueChange={(val) => setEditCompanyData({...editCompanyData, branche: val as any})}
                >
                  <SelectTrigger className="rounded-xl border border-muted-foreground/15 h-10">
                    <SelectValue placeholder="Industry" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {BRANCHES.map(b => (
                      <SelectItem key={b} value={b} className="font-semibold">{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-tier" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tiers Category</Label>
                <Select 
                  value={editCompanyData.tier || ''} 
                  onValueChange={(val) => setEditCompanyData({...editCompanyData, tier: val as any})}
                >
                  <SelectTrigger className="rounded-xl border border-muted-foreground/15 h-10">
                    <SelectValue placeholder="Support tier" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="Enterprise" className="font-semibold">Enterprise</SelectItem>
                    <SelectItem value="Pro" className="font-semibold">Pro</SelectItem>
                    <SelectItem value="Standard" className="font-semibold">Standard</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-owner" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Account Owner</Label>
                <Input 
                  id="edit-owner" 
                  value={editCompanyData.accountOwner || ''}
                  onChange={(e) => setEditCompanyData({...editCompanyData, accountOwner: e.target.value})}
                  className="rounded-xl border border-muted-foreground/15 h-10 font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-spend" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Monthly Spend</Label>
                <Input 
                  id="edit-spend" 
                  value={editCompanyData.monthlySpend || ''}
                  onChange={(e) => setEditCompanyData({...editCompanyData, monthlySpend: e.target.value})}
                  className="rounded-xl border border-muted-foreground/15 h-10 font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-plan" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Contract SLA Plan</Label>
                <Input 
                  id="edit-plan" 
                  value={editCompanyData.contractPlan || ''}
                  onChange={(e) => setEditCompanyData({...editCompanyData, contractPlan: e.target.value})}
                  className="rounded-xl border border-muted-foreground/15 h-10 font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-sla" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Support SLA Response</Label>
                <Input 
                  id="edit-sla" 
                  value={editCompanyData.contractSla || ''}
                  onChange={(e) => setEditCompanyData({...editCompanyData, contractSla: e.target.value})}
                  className="rounded-xl border border-muted-foreground/15 h-10 font-semibold"
                />
              </div>

              {/* Health Score Slider representation */}
              <div className="space-y-1.5 col-span-2 p-3 bg-muted/30 rounded-xl border">
                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <span>Customer Health Score</span>
                  <span className="text-primary font-black">{editCompanyData.healthScore || 0} / 100</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={editCompanyData.healthScore || 0}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    let hStatus = 'Healthy';
                    if (val < 40) hStatus = 'Contract Expiring';
                    else if (val < 55) hStatus = 'SLA Risk';
                    else if (val < 80) hStatus = 'Warning';
                    setEditCompanyData({
                      ...editCompanyData, 
                      healthScore: val,
                      healthStatus: hStatus
                    });
                  }}
                  className="w-full h-1.5 bg-primary/20 accent-primary rounded-lg appearance-auto cursor-pointer"
                />
                <p className="text-[10px] text-muted-foreground/75 font-semibold mt-1">
                  Sliding changes the account health pill state dynamically. Less than 40 = Expiring Contract, less than 55 = SLA Risk, less than 80 = Warning.
                </p>
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-muted">
              <Button 
                type="button" 
                variant="ghost" 
                onClick={() => setIsEditDialogOpen(false)}
                className="rounded-xl font-bold h-10 px-4 text-xs"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isSaving}
                className="bg-primary hover:bg-primary/95 text-white font-extrabold rounded-xl px-5 h-10 text-xs shadow-md shadow-primary/10"
              >
                {isSaving ? <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Edit3 className="w-3.5 h-3.5 mr-2" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ADD CONTACT DIALOG */}
      <Dialog open={isContactDialogOpen} onOpenChange={setIsContactDialogOpen}>
        <DialogContent className="sm:max-w-[500px] rounded-[24px] p-6 border border-muted-foreground/10 overflow-hidden bg-background">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-lg font-extrabold tracking-tight flex items-center gap-2">
              <div className="p-2 bg-indigo-505/10 text-indigo-500 rounded-xl shrink-0">
                <Users className="w-5 h-5" />
              </div>
              Add New Contact
            </DialogTitle>
            <DialogDescription className="text-xs font-semibold text-muted-foreground">
              Register a client contact associated with {hydratedCompany?.name}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateContact} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs text-foreground font-semibold">
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="contact-name" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Full Name</Label>
                <Input 
                  id="contact-name" 
                  placeholder="John Doe" 
                  value={newContact.name}
                  onChange={(e) => setNewContact({...newContact, name: e.target.value})}
                  className="rounded-xl border border-muted-foreground/15 h-10 font-medium"
                />
              </div>
              
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="contact-email" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Email Address</Label>
                <Input 
                  id="contact-email" 
                  type="email"
                  placeholder="john@example.com" 
                  value={newContact.email}
                  onChange={(e) => setNewContact({...newContact, email: e.target.value})}
                  className="rounded-xl border border-muted-foreground/15 h-10 font-medium"
                />
              </div>

              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="contact-title" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Job Title</Label>
                <Input 
                  id="contact-title" 
                  placeholder="Engineering Lead" 
                  value={newContact.title}
                  onChange={(e) => setNewContact({...newContact, title: e.target.value})}
                  className="rounded-xl border border-muted-foreground/15 h-10 font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contact-work" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Work Phone</Label>
                <Input 
                  id="contact-work" 
                  placeholder="+1..." 
                  value={newContact.phoneWork}
                  onChange={(e) => setNewContact({...newContact, phoneWork: e.target.value})}
                  className="rounded-xl border border-muted-foreground/15 h-10 font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contact-mobile" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Mobile Phone</Label>
                <Input 
                  id="contact-mobile" 
                  placeholder="+1..." 
                  value={newContact.phoneMobile}
                  onChange={(e) => setNewContact({...newContact, phoneMobile: e.target.value})}
                  className="rounded-xl border border-muted-foreground/15 h-10 font-medium"
                />
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-muted">
              <Button 
                type="button" 
                variant="ghost" 
                onClick={() => setIsContactDialogOpen(false)}
                className="rounded-xl font-bold h-10 px-4 text-xs"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isSaving}
                className="bg-primary hover:bg-primary/95 text-white font-extrabold rounded-xl px-5 h-10 text-xs shadow-md shadow-primary/10"
              >
                {isSaving ? <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-2" />}
                Add Contact
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  );
}
