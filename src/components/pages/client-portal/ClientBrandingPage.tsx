import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Loader2, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { OrgPortalBrandingCard } from '../../client-portal/OrgPortalBrandingCard';
import { PortalModulesCard } from '../../client-portal/PortalModulesCard';
import { MandantenKiRagCard } from '../../client-portal/MandantenKiRagCard';
import { HardwareReturnsModuleCard } from '../../client-portal/HardwareReturnsModuleCard';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';
import {
  resolvePortalSettingsPaths,
  type PortalSettingsMode,
} from '../../../lib/client-portal/portal-settings-api-base';

type OrgBranding = {
  id: string;
  name: string;
  logo_url: string | null;
  portal_title: string | null;
  portal_banner_url: string | null;
  favicon_url: string | null;
  secure_exchange_enabled?: boolean;
  vault_enabled?: boolean;
  hardware_returns_enabled?: boolean;
  hardware_returns_config?: Record<string, unknown> | null;
  enabledModules?: { secureExchange?: boolean; vault?: boolean; hardwareReturns?: boolean };
};

export type ClientBrandingPageProps = {
  /** portal = Kunden-Portal session; admin = Hubcom Staff for :orgId */
  mode?: PortalSettingsMode;
  organizationId?: string | null;
  /** When false, omit MandantenKi (admin cockpit has its own KI segment). Default true in portal. */
  includeAi?: boolean;
  /** Admin-only: show hardware returns module card. */
  showHardwareModule?: boolean;
  /** Compact shell for embedding in /admin/customers. */
  embedded?: boolean;
  className?: string;
};

/**
 * Portal-Branding: logo, title, favicon, banner + module toggles.
 * Shared by `/portal/branding` and Admin `Kunden-Portal` → Branding & Module.
 */
export default function ClientBrandingPage({
  mode = 'portal',
  organizationId = null,
  includeAi,
  showHardwareModule,
  embedded = false,
  className,
}: ClientBrandingPageProps) {
  const { session, isClientAdmin } = useClientPortalSession();
  const [org, setOrg] = useState<OrgBranding | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const orgIdKey = String(organizationId || '').trim();
  const paths = useMemo(() => {
    try {
      return resolvePortalSettingsPaths(mode, organizationId);
    } catch {
      return null;
    }
  }, [mode, orgIdKey]);
  const brandingGet = paths?.brandingGet ?? '';
  const fetchGenRef = useRef(0);

  const showAi = includeAi ?? mode === 'portal';
  const showHardware = showHardwareModule ?? mode === 'admin';

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!brandingGet) return;
      const gen = ++fetchGenRef.current;
      setLoading(true);
      try {
        const res = await axios.get(brandingGet, { withCredentials: true, signal });
        if (signal?.aborted || gen !== fetchGenRef.current) return;
        const organization =
          res.data?.organization ||
          (res.data?.branding
            ? {
                id: organizationId || '',
                name: res.data?.organization?.name || '',
                ...res.data.branding,
                ...res.data.modules,
              }
            : null);
        if (res.data?.modules && organization) {
          organization.hardware_returns_enabled =
            res.data.modules.hardware_returns_enabled ?? organization.hardware_returns_enabled;
          organization.secure_exchange_enabled =
            res.data.modules.secure_exchange_enabled ?? organization.secure_exchange_enabled;
          organization.vault_enabled =
            res.data.modules.vault_enabled ?? organization.vault_enabled;
        }
        setOrg(organization);
      } catch (err: any) {
        if (
          signal?.aborted ||
          gen !== fetchGenRef.current ||
          err?.code === 'ERR_CANCELED' ||
          err?.name === 'CanceledError' ||
          axios.isCancel?.(err)
        ) {
          return;
        }
        toast.error(err?.response?.data?.error || 'Branding konnte nicht geladen werden.');
        setOrg(null);
      } finally {
        if (gen === fetchGenRef.current && !signal?.aborted) setLoading(false);
      }
    },
    [brandingGet, organizationId],
  );

  useEffect(() => {
    if (!brandingGet) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    void load(ac.signal);
    return () => {
      ac.abort();
      fetchGenRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional primitive gate
  }, [mode, orgIdKey, brandingGet]);

  if (mode === 'portal' && !isClientAdmin) {
    return (
      <div className="p-10 text-center text-sm text-slate-500">
        Nur Kunden-Admins können das Portal-Branding verwalten.
      </div>
    );
  }

  if (!paths) {
    return (
      <div className="p-10 text-center text-sm text-slate-500">
        Organisation nicht ausgewählt.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-slate-400 text-sm p-12">
        <Loader2 className="w-4 h-4 animate-spin" /> Branding wird geladen…
      </div>
    );
  }

  if (!org) {
    return (
      <div className="p-10 text-center text-sm text-slate-500">
        Organisation nicht gefunden.
      </div>
    );
  }

  const shellClass = embedded
    ? `space-y-6 ${className || ''}`
    : `flex-1 overflow-y-auto bg-[#F8F9FA] ${className || ''}`;
  const innerClass = embedded
    ? 'w-full space-y-6'
    : 'max-w-3xl mx-auto w-full px-4 sm:px-6 py-8 space-y-6 pb-20';

  return (
    <div className={shellClass}>
      <div className={innerClass}>
        {!embedded ? (
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-slate-900">Portal-Branding</h1>
              <p className="text-sm text-slate-500 font-medium mt-1">
                Logo, Browser-Tab-Titel, Favicon und Dashboard-Banner für {org.name}
                {mode === 'portal' && session?.organizationId
                  ? ` · ${session.organizationId.slice(0, 8)}…`
                  : ''}
              </p>
            </div>
          </div>
        ) : null}

        <PortalModulesCard
          mode={mode === 'admin' ? 'admin' : 'portal'}
          organizationId={mode === 'admin' ? organizationId : undefined}
          secureExchangeEnabled={
            org.enabledModules?.secureExchange !== false &&
            org.secure_exchange_enabled !== false
          }
          vaultEnabled={
            org.enabledModules?.vault !== false && org.vault_enabled !== false
          }
          onSaved={(next) => {
            setOrg((prev) =>
              prev
                ? {
                    ...prev,
                    secure_exchange_enabled: next.secure_exchange_enabled,
                    vault_enabled: next.vault_enabled,
                    enabledModules: {
                      ...(prev.enabledModules || {}),
                      secureExchange: next.secure_exchange_enabled,
                      vault: next.vault_enabled,
                    },
                  }
                : prev,
            );
          }}
        />

        {showHardware && mode === 'admin' && organizationId ? (
          <HardwareReturnsModuleCard
            organizationId={organizationId}
            enabled={Boolean(org.hardware_returns_enabled)}
            config={org.hardware_returns_config || undefined}
            onSaved={(next) => {
              setOrg((prev) =>
                prev
                  ? {
                      ...prev,
                      hardware_returns_enabled: next.hardware_returns_enabled,
                      hardware_returns_config: next.hardware_returns_config || null,
                    }
                  : prev,
              );
            }}
          />
        ) : null}

        {showAi ? (
          <MandantenKiRagCard
            mode={mode === 'admin' ? 'admin' : 'portal'}
            organizationId={mode === 'admin' ? organizationId : undefined}
            organizationName={org.name}
          />
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
          <OrgPortalBrandingCard
            organizationName={org.name}
            logoUrl={org.logo_url}
            portalTitle={org.portal_title}
            bannerUrl={org.portal_banner_url}
            faviconUrl={org.favicon_url}
            saving={saving}
            onSave={async (payload) => {
              setSaving(true);
              try {
                if (payload.clearLogo) {
                  await axios.delete(paths.logoDelete, { withCredentials: true });
                } else {
                  await axios.put(
                    paths.brandingPut,
                    {
                      ...(payload.logoDataUrl !== undefined
                        ? { logoDataUrl: payload.logoDataUrl }
                        : {}),
                      ...(payload.portal_title !== undefined
                        ? { portal_title: payload.portal_title }
                        : {}),
                    },
                    { withCredentials: true },
                  );
                }
                await load();
                window.dispatchEvent(new CustomEvent('hubcom-portal-branding-changed'));
              } finally {
                setSaving(false);
              }
            }}
            onBannerUpload={async (bannerDataUrl) => {
              setSaving(true);
              try {
                await axios.post(
                  paths.bannerPost,
                  { bannerDataUrl },
                  { withCredentials: true },
                );
                await load();
              } finally {
                setSaving(false);
              }
            }}
            onBannerRemove={async () => {
              setSaving(true);
              try {
                await axios.delete(paths.bannerDelete, { withCredentials: true });
                await load();
              } finally {
                setSaving(false);
              }
            }}
            onFaviconUpload={async (faviconDataUrl) => {
              setSaving(true);
              try {
                await axios.post(
                  paths.faviconPost,
                  { faviconDataUrl },
                  { withCredentials: true },
                );
                await load();
                window.dispatchEvent(new CustomEvent('hubcom-portal-branding-changed'));
              } finally {
                setSaving(false);
              }
            }}
            onFaviconRemove={async () => {
              setSaving(true);
              try {
                await axios.delete(paths.faviconDelete, { withCredentials: true });
                await load();
                window.dispatchEvent(new CustomEvent('hubcom-portal-branding-changed'));
              } finally {
                setSaving(false);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
