import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Loader2, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { OrgPortalBrandingCard } from '../../client-portal/OrgPortalBrandingCard';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';

type OrgBranding = {
  id: string;
  name: string;
  logo_url: string | null;
  portal_title: string | null;
  portal_banner_url: string | null;
  favicon_url: string | null;
};

/**
 * CLIENT_ADMIN-only Portal-Branding: logo, title, dashboard banner with live preview.
 */
export default function ClientBrandingPage() {
  const { session, isClientAdmin } = useClientPortalSession();
  const [org, setOrg] = useState<OrgBranding | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/portal/organization', { withCredentials: true });
      setOrg(res.data?.organization || null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Branding konnte nicht geladen werden.');
      setOrg(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isClientAdmin) {
    return (
      <div className="p-10 text-center text-sm text-slate-500">
        Nur Kunden-Admins können das Portal-Branding verwalten.
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

  return (
    <div className="flex-1 overflow-y-auto bg-[#F8F9FA]">
      <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-8 space-y-6 pb-20">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
            <Palette className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-slate-900">Portal-Branding</h1>
            <p className="text-sm text-slate-500 font-medium mt-1">
              Logo, Portal-Titel, Favicon und Dashboard-Banner für {org.name}
              {session?.organizationId ? ` · ${session.organizationId.slice(0, 8)}…` : ''}
            </p>
          </div>
        </div>

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
                  await axios.delete('/api/portal/organization/logo', { withCredentials: true });
                } else {
                  await axios.put(
                    '/api/portal/organization/branding',
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
              } finally {
                setSaving(false);
              }
            }}
            onBannerUpload={async (bannerDataUrl) => {
              setSaving(true);
              try {
                await axios.post(
                  '/api/portal/branding/banner',
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
                await axios.delete('/api/portal/branding/banner', { withCredentials: true });
                await load();
              } finally {
                setSaving(false);
              }
            }}
            onFaviconUpload={async (faviconDataUrl) => {
              setSaving(true);
              try {
                await axios.post(
                  '/api/portal/branding/favicon',
                  { faviconDataUrl },
                  { withCredentials: true },
                );
                await load();
              } finally {
                setSaving(false);
              }
            }}
            onFaviconRemove={async () => {
              setSaving(true);
              try {
                await axios.delete('/api/portal/branding/favicon', { withCredentials: true });
                await load();
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
