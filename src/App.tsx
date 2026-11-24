import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import MainLayout from './components/layout/MainLayout';
import ClientPortalLayout from './components/client-portal/ClientPortalLayout';
import LoginPage from './components/pages/LoginPage';
import OnboardingWizardPage from './components/pages/OnboardingWizardPage';
import { useAuth, useAdmin } from './lib/hooks';
import { usePermissions } from './hooks/usePermissions';
import { useClientPortalSession } from './hooks/useClientPortalSession';
import { isSystemAdminSession } from './lib/beta-admin-bypass';
import { ErrorBoundary, ModuleCrashFallback } from './components/ErrorBoundary';
import { useOnboardingStatus } from './hooks/useOnboardingStatus';
import { getModuleConfig, type PlatformModules } from './lib/module-config';
import { toast } from 'sonner';
import { AuthProvider } from './lib/context/AuthContext';
import { SidebarProvider } from './lib/context/SidebarContext';
import { WorkspaceProvider } from './lib/context/WorkspaceContext';
import { ThemeProvider } from './lib/context/ThemeContext';
import { I18nProvider } from './lib/context/I18nContext';
import { brandConfig } from './lib/brandConfig';

const DashboardPage = lazy(() => import('./components/pages/DashboardPage'));
const TicketsPage = lazy(() => import('./components/pages/TicketsPage'));
const KBPage = lazy(() => import('./components/pages/KBPage'));
const CustomersPage = lazy(() => import('./components/pages/CustomersPage'));
const SettingsPage = lazy(() => import('./components/pages/SettingsPage'));
const BrandingAdminPage = lazy(() => import('./components/pages/BrandingAdminPage'));
const VaultPage = lazy(() => import('./components/pages/VaultPage'));
const CredentialVaultPage = lazy(() => import('./components/pages/CredentialVaultPage'));
const InsightsPage = lazy(() => import('./components/pages/InsightsPage'));
const AuditLogPage = lazy(() => import('./components/pages/AuditLogPage'));
const GeistDeskMigratorPage = lazy(() => import('./components/pages/GeistDeskMigratorPage'));
const EmailChannelsPage = lazy(() => import('./components/pages/EmailChannelsPage'));
const LegalSettingsPage = lazy(() => import('./components/pages/LegalSettingsPage'));
const AdminHubPage = lazy(() => import('./components/pages/AdminHubPage'));
const AdminHubLayout = lazy(() => import('./components/admin/hub/AdminHubLayout'));
const AdminHubRagPipelinePage = lazy(() => import('./components/admin/hub/AdminHubRagPipelinePage'));
const AdminHubRagSearchPage = lazy(() => import('./components/admin/hub/AdminHubRagSearchPage'));
const PolyglotBridgeAdminPage = lazy(() => import('./components/pages/PolyglotBridgeAdminPage'));
const NotificationEnginePage = lazy(() => import('./components/pages/NotificationEnginePage'));
const CompanySchemaPage = lazy(() => import('./components/pages/CompanySchemaPage'));
const ContactSchemaPage = lazy(() => import('./components/pages/ContactSchemaPage'));
const PIIShieldPage = lazy(() => import('./components/pages/PIIShieldPage'));
const SovereigntyCenterPage = lazy(() => import('./components/pages/SovereigntyCenterPage'));
const IntegrationsPage = lazy(() => import('./components/pages/IntegrationsPage'));
const GroupsPage = lazy(() => import('./components/pages/GroupsPage'));
const WorkforcePage = lazy(() => import('./components/pages/WorkforcePage'));
const UserManagementPage = lazy(() => import('./components/pages/UserManagementPage'));
const RolesPage = lazy(() => import('./components/pages/RolesPage'));
const VaultPortfolioManagementPage = lazy(() => import('./components/pages/VaultPortfolioManagementPage'));
const AdminImportPage = lazy(() => import('./components/pages/AdminImportPage'));
const HelpCenterPage = lazy(() => import('./components/pages/HelpCenterPage'));
const SecretViewerPage = lazy(() => import('./components/pages/SecretViewerPage'));
const TimeTrackingAdminPage = lazy(() => import('./components/pages/TimeTrackingAdminPage'));
const TimeTrackingOverviewPage = lazy(() => import('./components/pages/TimeTrackingOverviewPage'));
const TicketCategoriesAdminPage = lazy(() => import('./components/pages/TicketCategoriesAdminPage'));
/** Hubcom legacy customer portal (role === customer) — keep alongside Phase 2–5 CLIENT_* portal. */
const PortalLayout = lazy(() => import('./components/portal/PortalLayout'));
const PortalTicketsPage = lazy(() => import('./components/portal/PortalTicketsPage'));
const PortalTicketDetailPage = lazy(() => import('./components/portal/PortalTicketDetailPage'));
const PortalCreateTicketPage = lazy(() => import('./components/portal/PortalCreateTicketPage'));
const PortalDashboardPage = lazy(
  () => import('./components/pages/client-portal/PortalDashboardPage'),
);
const ClientTicketsPage = lazy(() => import('./components/pages/client-portal/ClientTicketsPage'));
const ClientCreateTicketPage = lazy(
  () => import('./components/pages/client-portal/ClientCreateTicketPage'),
);
const ClientTicketDetailPage = lazy(
  () => import('./components/pages/client-portal/ClientTicketDetailPage'),
);
const ClientMembersPage = lazy(() => import('./components/pages/client-portal/ClientMembersPage'));
const ClientEmailIntegrationPage = lazy(
  () => import('./components/pages/client-portal/ClientEmailIntegrationPage'),
);
const ClientBrandingPage = lazy(
  () => import('./components/pages/client-portal/ClientBrandingPage'),
);
const ClientKbPage = lazy(() => import('./components/pages/client-portal/ClientKbPage'));
const ClientExchangePage = lazy(
  () => import('./components/pages/client-portal/ClientExchangePage'),
);
const ClientVaultPage = lazy(() => import('./components/pages/client-portal/ClientVaultPage'));

function RouteFallback() {
  return (
    <div className="h-full w-full flex items-center justify-center p-20 bg-background">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  );
}

function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

function AdminRoute({ children }: { children: ReactNode }) {
  const { loading: authLoading } = useAuth();
  const { isAdmin, checking } = useAdmin();
  const { isClient, loading: clientLoading } = useClientPortalSession();

  if (authLoading || checking || clientLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center p-20 bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (isClient) {
    return <Navigate to="/portal/dashboard" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

/** Gate for /portal/* — only CLIENT_* roles. */
function ClientPortalRoute({ children }: { children: ReactNode }) {
  const { loading: authLoading } = useAuth();
  const { isClient, isClientAdmin, loading } = useClientPortalSession();

  if (authLoading || loading) {
    return (
      <div className="h-full w-full flex items-center justify-center p-20 bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isClient) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function ClientAdminRoute({ children }: { children: ReactNode }) {
  const { isClientAdmin, isClient, loading } = useClientPortalSession();
  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center p-20 bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }
  if (!isClient) return <Navigate to="/dashboard" replace />;
  if (!isClientAdmin) return <Navigate to="/portal/dashboard" replace />;
  return <>{children}</>;
}

/** CLIENT_ADMIN + CLIENT_SUPPORTER only (hides Tresor from CLIENT_USER). */
function ClientOrgWideRoute({ children }: { children: ReactNode }) {
  const { isOrgWide, isClient, loading } = useClientPortalSession();
  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center p-20 bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }
  if (!isClient) return <Navigate to="/dashboard" replace />;
  if (!isOrgWide) return <Navigate to="/portal/dashboard" replace />;
  return <>{children}</>;
}

/** Redirect Hubcom shell away from client accounts (and vice versa). */
function StaffShellRedirect({ children }: { children: ReactNode }) {
  const { isClient, loading } = useClientPortalSession();
  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center p-20 bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }
  if (isClient) return <Navigate to="/portal/dashboard" replace />;
  return <>{children}</>;
}

function ClientAwareHomeRedirect() {
  const { isClient, loading } = useClientPortalSession();
  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center p-20 bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }
  return <Navigate to={isClient ? '/portal/dashboard' : '/dashboard'} replace />;
}

function OnboardingGate({ children }: { children: ReactNode }) {
  const { isAdmin, checking } = useAdmin();
  const { role, userProfile, loading } = usePermissions();
  const { status, loading: onboardingLoading } = useOnboardingStatus();
  const isSystemAdmin = isSystemAdminSession(isAdmin, userProfile, role);

  if (checking || loading || onboardingLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center p-20 bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (isSystemAdmin && !status?.isInitialized && status?.hasAdminUser !== true) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

function ModuleRoute({
  module,
  children,
}: {
  module: keyof Omit<PlatformModules, 'tickets'>;
  children: ReactNode;
}) {
  const location = useLocation();
  const [flags, setFlags] = useState(() => getModuleConfig().platformModules);

  useEffect(() => {
    const sync = () => setFlags(getModuleConfig().platformModules);
    window.addEventListener('module-config-changed', sync);
    return () => window.removeEventListener('module-config-changed', sync);
  }, []);

  if (!flags[module]) {
    toast.info('This module is disabled for this workspace.', { id: `module-disabled-${module}` });
    return <Navigate to="/dashboard" replace state={{ from: location.pathname, moduleDisabled: module }} />;
  }
  return <>{children}</>;
}

export default function App() {
  useEffect(() => {
    document.title = brandConfig.documentTitle;
    document.documentElement.lang = document.documentElement.lang || 'de';
  }, []);

  return (
    <I18nProvider>
      <ThemeProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

function isCustomerRole(profileRole: string | undefined | null, rbacName?: string | null): boolean {
  const r = String(profileRole || '').toLowerCase();
  const n = String(rbacName || '').toLowerCase();
  return r === 'customer' || n === 'customer';
}

function AppRoutes() {
  const { user, loading } = useAuth();
  const { status, loading: onboardingLoading } = useOnboardingStatus();
  const { userProfile, role, loading: permissionsLoading } = usePermissions();
  const firstRun = status?.hasAdminUser !== true && status?.isInitialized !== true;
  const needsResume = status?.needsResume === true && status?.hasAdminUser === true;
  const isCustomer =
    !!user && isCustomerRole(userProfile?.role, role?.name);

  if (loading || onboardingLoading || (user && permissionsLoading)) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center gap-4 bg-muted">
        <div className="flex -space-x-2 animate-pulse">
           <div className="w-4 h-10 bg-[#4285F4] rounded-full"></div>
           <div className="w-4 h-10 bg-[#EA4335] rounded-full"></div>
           <div className="w-4 h-10 bg-[#FBBC05] rounded-full"></div>
           <div className="w-4 h-10 bg-[#34A853] rounded-full"></div>
        </div>
        <p className="text-xs font-bold text-[#5F6368] uppercase tracking-widest">Wird geladen…</p>
      </div>
    );
  }

  return (
        <SidebarProvider>
          <WorkspaceProvider>
          <TooltipProvider>
            <div className="min-h-screen bg-background font-sans antialiased text-foreground">
            <ErrorBoundary fallback={<ModuleCrashFallback module="Application" />}>
            <Routes>
                <Route path="/help" element={<LazyPage><HelpCenterPage /></LazyPage>} />
                <Route path="/v/:id" element={<LazyPage><SecretViewerPage /></LazyPage>} />
                {firstRun || needsResume ? (
                  <>
                    <Route path="/onboarding" element={<OnboardingWizardPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="*" element={<Navigate to="/onboarding" replace />} />
                  </>
                ) : !user ? (
                  <>
                    <Route path="/onboarding" element={<Navigate to="/login" replace />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="*" element={<LoginPage />} />
                  </>
                ) : isCustomer ? (
                  <>
                    {/* Hubcom legacy role=customer portal (a31c080) — kept for existing customers.
                        New MSP CLIENT_* roles use ClientPortalLayout below. */}
                    <Route path="/login" element={<Navigate to="/portal" replace />} />
                    <Route path="/onboarding" element={<Navigate to="/portal" replace />} />
                    <Route
                      path="/portal"
                      element={
                        <LazyPage>
                          <PortalLayout />
                        </LazyPage>
                      }
                    >
                      <Route
                        index
                        element={
                          <ErrorBoundary fallback={<ModuleCrashFallback module="Kundenportal" />}>
                            <LazyPage>
                              <PortalTicketsPage />
                            </LazyPage>
                          </ErrorBoundary>
                        }
                      />
                      <Route
                        path="new"
                        element={
                          <ErrorBoundary fallback={<ModuleCrashFallback module="Kundenportal" />}>
                            <LazyPage>
                              <PortalCreateTicketPage />
                            </LazyPage>
                          </ErrorBoundary>
                        }
                      />
                      <Route
                        path="tickets/:id"
                        element={
                          <ErrorBoundary fallback={<ModuleCrashFallback module="Kundenportal" />}>
                            <LazyPage>
                              <PortalTicketDetailPage />
                            </LazyPage>
                          </ErrorBoundary>
                        }
                      />
                    </Route>
                    <Route path="/tickets/*" element={<Navigate to="/portal" replace />} />
                    <Route path="/vault/*" element={<Navigate to="/portal" replace />} />
                    <Route path="/credentials/*" element={<Navigate to="/portal" replace />} />
                    <Route path="/admin/*" element={<Navigate to="/portal" replace />} />
                    <Route path="/kb/*" element={<Navigate to="/portal" replace />} />
                    <Route path="/kb-intern/*" element={<Navigate to="/portal" replace />} />
                    <Route path="/dashboard/*" element={<Navigate to="/portal" replace />} />
                    <Route path="/settings/*" element={<Navigate to="/portal" replace />} />
                    <Route path="/customers/*" element={<Navigate to="/portal" replace />} />
                    <Route path="/email-channels/*" element={<Navigate to="/portal" replace />} />
                    <Route path="*" element={<Navigate to="/portal" replace />} />
                  </>
                ) : (
                  <>
                    <Route path="/onboarding" element={<ClientAwareHomeRedirect />} />

                    {/* Kunden-Portal — CLIENT_* roles only */}
                    <Route
                      path="/portal"
                      element={
                        <ClientPortalRoute>
                          <ClientPortalLayout />
                        </ClientPortalRoute>
                      }
                    >
                      <Route index element={<Navigate to="dashboard" replace />} />
                      <Route
                        path="dashboard"
                        element={
                          <ErrorBoundary fallback={<ModuleCrashFallback module="Portal Dashboard" />}>
                            <LazyPage>
                              <PortalDashboardPage />
                            </LazyPage>
                          </ErrorBoundary>
                        }
                      />
                      <Route
                        path="tickets"
                        element={
                          <ErrorBoundary fallback={<ModuleCrashFallback module="Portal Tickets" />}>
                            <LazyPage>
                              <ClientTicketsPage />
                            </LazyPage>
                          </ErrorBoundary>
                        }
                      />
                      <Route
                        path="tickets/new"
                        element={
                          <ErrorBoundary fallback={<ModuleCrashFallback module="Portal Create Ticket" />}>
                            <LazyPage>
                              <ClientCreateTicketPage />
                            </LazyPage>
                          </ErrorBoundary>
                        }
                      />
                      <Route
                        path="tickets/:ticketId"
                        element={
                          <ErrorBoundary fallback={<ModuleCrashFallback module="Portal Ticket Detail" />}>
                            <LazyPage>
                              <ClientTicketDetailPage />
                            </LazyPage>
                          </ErrorBoundary>
                        }
                      />
                      <Route
                        path="members"
                        element={
                          <ClientAdminRoute>
                            <ErrorBoundary fallback={<ModuleCrashFallback module="Portal Members" />}>
                              <LazyPage>
                                <ClientMembersPage />
                              </LazyPage>
                            </ErrorBoundary>
                          </ClientAdminRoute>
                        }
                      />
                      <Route
                        path="email"
                        element={
                          <ClientAdminRoute>
                            <ErrorBoundary fallback={<ModuleCrashFallback module="Portal Email" />}>
                              <LazyPage>
                                <ClientEmailIntegrationPage />
                              </LazyPage>
                            </ErrorBoundary>
                          </ClientAdminRoute>
                        }
                      />
                      <Route
                        path="branding"
                        element={
                          <ClientAdminRoute>
                            <ErrorBoundary fallback={<ModuleCrashFallback module="Portal Branding" />}>
                              <LazyPage>
                                <ClientBrandingPage />
                              </LazyPage>
                            </ErrorBoundary>
                          </ClientAdminRoute>
                        }
                      />
                      <Route
                        path="kb"
                        element={
                          <ErrorBoundary fallback={<ModuleCrashFallback module="Portal Wissensdatenbank" />}>
                            <LazyPage>
                              <ClientKbPage />
                            </LazyPage>
                          </ErrorBoundary>
                        }
                      />
                      <Route
                        path="exchange"
                        element={
                          <ErrorBoundary fallback={<ModuleCrashFallback module="Portal Sicherer Austausch" />}>
                            <LazyPage>
                              <ClientExchangePage />
                            </LazyPage>
                          </ErrorBoundary>
                        }
                      />
                      <Route
                        path="vault"
                        element={
                          <ClientOrgWideRoute>
                            <ErrorBoundary fallback={<ModuleCrashFallback module="Portal Tresor" />}>
                              <LazyPage>
                                <ClientVaultPage />
                              </LazyPage>
                            </ErrorBoundary>
                          </ClientOrgWideRoute>
                        }
                      />
                      <Route path="*" element={<Navigate to="dashboard" replace />} />
                    </Route>

                    <Route
                      path="/"
                      element={
                        <StaffShellRedirect>
                          <OnboardingGate>
                            <MainLayout />
                          </OnboardingGate>
                        </StaffShellRedirect>
                      }
                    >
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="dashboard" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Dashboard" />}><LazyPage><DashboardPage /></LazyPage></ErrorBoundary>} />
                    <Route path="tickets" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Tickets" />}><LazyPage><TicketsPage /></LazyPage></ErrorBoundary>} />
                    <Route path="tickets/:ticketId" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Tickets" />}><LazyPage><TicketsPage /></LazyPage></ErrorBoundary>} />
                    <Route path="customers" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Customers" />}><LazyPage><CustomersPage /></LazyPage></ErrorBoundary>} />
                    <Route path="kb" element={<ModuleRoute module="geistKB"><ErrorBoundary fallback={<ModuleCrashFallback module="GeistKB" />}><LazyPage><KBPage /></LazyPage></ErrorBoundary></ModuleRoute>} />
                    <Route path="migrator" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Migrator" />}><LazyPage><GeistDeskMigratorPage /></LazyPage></ErrorBoundary>} />
                    <Route path="vault" element={<ModuleRoute module="geistExchange"><ErrorBoundary fallback={<ModuleCrashFallback module="Geist Exchange" />}><LazyPage><VaultPage /></LazyPage></ErrorBoundary></ModuleRoute>} />
                    <Route path="credentials" element={<ModuleRoute module="geistVault"><ErrorBoundary fallback={<ModuleCrashFallback module="GeistVault" />}><LazyPage><CredentialVaultPage /></LazyPage></ErrorBoundary></ModuleRoute>} />
                    <Route path="insights" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Insights" />}><LazyPage><InsightsPage /></LazyPage></ErrorBoundary>} />
                    <Route path="audit" element={<AdminRoute><ErrorBoundary fallback={<ModuleCrashFallback module="Audit Log" />}><LazyPage><AuditLogPage /></LazyPage></ErrorBoundary></AdminRoute>} />
                    <Route path="settings" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Settings" />}><LazyPage><SettingsPage /></LazyPage></ErrorBoundary>} />
                    <Route path="ai-orchestrator" element={<Navigate to="/admin?tab=ai-engine" replace />} />
                    <Route
                      path="admin"
                      element={
                        <AdminRoute>
                          <ErrorBoundary fallback={<ModuleCrashFallback module="Admin Hub" />}>
                            <LazyPage>
                              <AdminHubLayout />
                            </LazyPage>
                          </ErrorBoundary>
                        </AdminRoute>
                      }
                    >
                      <Route index element={<LazyPage><AdminHubPage /></LazyPage>} />
                      <Route path="mcp" element={<Navigate to="/admin?tab=integrations" replace />} />
                      <Route path="ai" element={<Navigate to="/admin?tab=ai-engine" replace />} />
                      <Route path="legal" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Legal Settings" />}><LazyPage><LegalSettingsPage /></LazyPage></ErrorBoundary>} />
                      <Route path="notifications" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Notification Engine" />}><LazyPage><NotificationEnginePage /></LazyPage></ErrorBoundary>} />
                      <Route path="schema" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Company Schema" />}><LazyPage><CompanySchemaPage /></LazyPage></ErrorBoundary>} />
                      <Route path="contact-schema" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Contact Schema" />}><LazyPage><ContactSchemaPage /></LazyPage></ErrorBoundary>} />
                      <Route path="pii" element={<ErrorBoundary fallback={<ModuleCrashFallback module="PII Shield" />}><LazyPage><PIIShieldPage /></LazyPage></ErrorBoundary>} />
                      <Route path="audit" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Audit Log" />}><LazyPage><AuditLogPage /></LazyPage></ErrorBoundary>} />
                      <Route path="sovereignty" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Sovereignty Center" />}><LazyPage><SovereigntyCenterPage /></LazyPage></ErrorBoundary>} />
                      <Route path="integrations" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Integrations" />}><LazyPage><IntegrationsPage /></LazyPage></ErrorBoundary>} />
                      <Route path="polyglot" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Polyglot Bridge" />}><LazyPage><PolyglotBridgeAdminPage /></LazyPage></ErrorBoundary>} />
                      <Route path="groups" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Groups" />}><LazyPage><GroupsPage /></LazyPage></ErrorBoundary>} />
                      <Route path="workforce" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Benutzerverwaltung" />}><LazyPage><UserManagementPage /></LazyPage></ErrorBoundary>} />
                      <Route path="users" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Benutzerverwaltung" />}><LazyPage><UserManagementPage /></LazyPage></ErrorBoundary>} />
                      <Route path="workforce-legacy" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Workforce" />}><LazyPage><WorkforcePage /></LazyPage></ErrorBoundary>} />
                      <Route path="roles" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Roles" />}><LazyPage><RolesPage /></LazyPage></ErrorBoundary>} />
                      <Route path="vault-portfolio" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Vault Portfolio" />}><LazyPage><VaultPortfolioManagementPage /></LazyPage></ErrorBoundary>} />
                      <Route path="import" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Import" />}><LazyPage><AdminImportPage /></LazyPage></ErrorBoundary>} />
                      <Route path="time-tracking" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Zeiterfassung" />}><LazyPage><TimeTrackingAdminPage /></LazyPage></ErrorBoundary>} />
                      <Route path="time-tracking/overview" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Zeiterfassung Gesamt" />}><LazyPage><TimeTrackingOverviewPage /></LazyPage></ErrorBoundary>} />
                      <Route path="ticket-configuration" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Ticket Configuration" />}><LazyPage><TicketCategoriesAdminPage /></LazyPage></ErrorBoundary>} />
                      <Route path="ticket-categories" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Ticket Configuration" />}><LazyPage><TicketCategoriesAdminPage /></LazyPage></ErrorBoundary>} />
                      <Route path="email-channels" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Email Channels" />}><LazyPage><EmailChannelsPage /></LazyPage></ErrorBoundary>} />
                      <Route path="customers" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Customers" />}><LazyPage><CustomersPage /></LazyPage></ErrorBoundary>} />
                      <Route path="settings" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Systemeinstellungen" />}><LazyPage><SettingsPage /></LazyPage></ErrorBoundary>} />
                      <Route path="branding" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Firmenbranding" />}><LazyPage><BrandingAdminPage /></LazyPage></ErrorBoundary>} />
                      <Route path="rag/pipeline" element={<ErrorBoundary fallback={<ModuleCrashFallback module="RAG Pipeline" />}><LazyPage><AdminHubRagPipelinePage /></LazyPage></ErrorBoundary>} />
                      <Route path="rag/search" element={<ErrorBoundary fallback={<ModuleCrashFallback module="RAG Search" />}><LazyPage><AdminHubRagSearchPage /></LazyPage></ErrorBoundary>} />
                      <Route path="insights" element={<ErrorBoundary fallback={<ModuleCrashFallback module="Insights" />}><LazyPage><InsightsPage /></LazyPage></ErrorBoundary>} />
                    </Route>
                    <Route path="email-channels" element={<Navigate to="/admin/email-channels" replace />} />
                    <Route path="*" element={<Navigate to="/tickets" replace />} />
                    </Route>
                  </>
                )}
              </Routes>
            </ErrorBoundary>
            <Toaster />
          </div>
          </TooltipProvider>
          </WorkspaceProvider>
        </SidebarProvider>
  );
}
