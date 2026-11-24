import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { KeyRound, Loader2, Mail, Shield, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Badge } from '../../ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { OrgPortalBrandingCard } from '../../client-portal/OrgPortalBrandingCard';
import { useTranslation } from '../../../lib/context/I18nContext';

interface PortalUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  isDeactivated?: boolean;
}

type PortalRole = 'CLIENT_ADMIN' | 'CLIENT_SUPPORTER' | 'CLIENT_USER';

interface CompanyPortalTabProps {
  organizationId: string | null | undefined;
  companyName: string;
  onOpenEmailConfig?: () => void;
  /** When true, scroll/focus the invite form (e.g. header quick action). */
  focusInvite?: boolean;
}

export default function CompanyPortalTab({
  organizationId,
  companyName,
  onOpenEmailConfig,
  focusInvite,
}: CompanyPortalTabProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<PortalUserRow[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [portalTitle, setPortalTitle] = useState<string | null>(null);
  const [emailSummary, setEmailSummary] = useState<{
    mailbox: string | null;
    enabled: boolean;
    sso_enabled: boolean;
    m365_tenant_id: string | null;
  } | null>(null);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<PortalRole>('CLIENT_ADMIN');
  const [saving, setSaving] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const [orgRes, usersRes] = await Promise.all([
        axios.get(`/api/admin/organizations/${encodeURIComponent(organizationId)}`, {
          withCredentials: true,
        }),
        axios.get(`/api/admin/organizations/${encodeURIComponent(organizationId)}/users`, {
          withCredentials: true,
        }),
      ]);
      const org = orgRes.data?.organization;
      setLogoUrl(org?.logo_url || null);
      setPortalTitle(org?.portal_title || null);
      setUsers(usersRes.data?.users || []);
      setEmailSummary({
        mailbox: usersRes.data?.emailChannel?.mailbox || null,
        enabled:
          usersRes.data?.emailChannel?.enabled !== false &&
          Boolean(usersRes.data?.emailChannel),
        sso_enabled: Boolean(usersRes.data?.sso_enabled ?? org?.sso_enabled),
        m365_tenant_id: usersRes.data?.m365_tenant_id || org?.m365_tenant_id || null,
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Portal-Daten konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!focusInvite) return;
    const el = document.getElementById('company-portal-invite');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusInvite, organizationId]);

  const saveBranding = async (payload: {
    logoDataUrl?: string | null;
    portal_title?: string | null;
    clearLogo?: boolean;
  }) => {
    if (!organizationId) return;
    const res = await axios.put(
      `/api/admin/organizations/${encodeURIComponent(organizationId)}/branding`,
      payload,
      { withCredentials: true },
    );
    const org = res.data?.organization;
    setLogoUrl(org?.logo_url ?? (payload.clearLogo ? null : logoUrl));
    if (payload.portal_title !== undefined) {
      setPortalTitle(payload.portal_title);
    } else if (org?.portal_title !== undefined) {
      setPortalTitle(org.portal_title);
    }
  };

  const invite = async () => {
    if (!organizationId || !inviteName.trim() || !inviteEmail.trim()) {
      toast.error(t('admin.orgs.inviteRequired', 'Name and email are required.'));
      return;
    }
    setSaving(true);
    setTempPassword(null);
    try {
      const res = await axios.post(
        `/api/admin/organizations/${encodeURIComponent(organizationId)}/invite-client-admin`,
        {
          name: inviteName.trim(),
          email: inviteEmail.trim(),
          role: inviteRole,
        },
        { withCredentials: true },
      );
      setTempPassword(res.data?.temporaryPassword || null);
      setInviteName('');
      setInviteEmail('');
      toast.success(
        t('companies.portal.invited', 'Portal-Benutzer für {{name}} provisioniert.').replace(
          '{{name}}',
          companyName,
        ),
      );
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Einladung fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (userId: string, role: PortalRole) => {
    if (!organizationId) return;
    setBusyUserId(userId);
    try {
      await axios.patch(
        `/api/admin/organizations/${encodeURIComponent(organizationId)}/users/${encodeURIComponent(userId)}`,
        { role },
        { withCredentials: true },
      );
      toast.success(t('companies.portal.roleUpdated', 'Rolle aktualisiert.'));
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Rollenänderung fehlgeschlagen');
    } finally {
      setBusyUserId(null);
    }
  };

  const resetPassword = async (userId: string) => {
    if (!organizationId) return;
    setBusyUserId(userId);
    setTempPassword(null);
    try {
      const res = await axios.post(
        `/api/admin/organizations/${encodeURIComponent(organizationId)}/users/${encodeURIComponent(userId)}/reset-password`,
        {},
        { withCredentials: true },
      );
      setTempPassword(res.data?.temporaryPassword || null);
      toast.success(t('companies.portal.passwordReset', 'Temporäres Passwort erzeugt.'));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Passwort-Reset fehlgeschlagen');
    } finally {
      setBusyUserId(null);
    }
  };

  if (!organizationId) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        {t(
          'companies.portal.missingOrg',
          'Noch keine verknüpfte Client-Organisation. Speichern Sie das Unternehmen erneut oder starten Sie die Org-Synchronisation.',
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-500" />
          {t('companies.portal.brandingTitle', 'White-Label Branding')}
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" /> : null}
        </h3>
        <OrgPortalBrandingCard
          organizationName={companyName}
          logoUrl={logoUrl}
          portalTitle={portalTitle}
          onSave={saveBranding}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-500" />
            {t('companies.portal.usersTitle', 'Portal-Benutzer & Admins')}
          </h3>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {users.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              {t('companies.portal.noUsers', 'Noch keine Portal-Benutzer für dieses Unternehmen.')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {users.map((u) => (
                <li
                  key={u.id}
                  className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{u.name || u.email}</p>
                    <p className="text-xs text-slate-500 truncate">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Select
                      value={u.role}
                      onValueChange={(val) => void changeRole(u.id, val as PortalRole)}
                      disabled={busyUserId === u.id}
                    >
                      <SelectTrigger className="h-8 w-[160px] text-[10px] font-extrabold uppercase">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CLIENT_ADMIN">CLIENT_ADMIN</SelectItem>
                        <SelectItem value="CLIENT_SUPPORTER">CLIENT_SUPPORTER</SelectItem>
                        <SelectItem value="CLIENT_USER">CLIENT_USER</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 text-[10px] font-bold"
                      disabled={busyUserId === u.id}
                      onClick={() => void resetPassword(u.id)}
                    >
                      {busyUserId === u.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <KeyRound className="w-3 h-3" />
                      )}
                      Reset
                    </Button>
                    {u.isDeactivated ? (
                      <Badge variant="destructive" className="text-[10px]">
                        inactive
                      </Badge>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          id="company-portal-invite"
          className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3"
        >
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <UserPlus className="w-3.5 h-3.5" />
            {t('companies.portal.inviteTitle', 'Portal-Benutzer einladen')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase">Name</Label>
              <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase">E-Mail</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER'] as const).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setInviteRole(role)}
                className={`text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-full border ${
                  inviteRole === role
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'bg-white border-slate-200 text-slate-500'
                }`}
              >
                {role.replace('CLIENT_', '')}
              </button>
            ))}
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => void invite()}
              className="ml-auto gap-1.5"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              {t('companies.portal.inviteCta', 'Einladen')}
            </Button>
          </div>
          {tempPassword ? (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              {t('admin.orgs.tempPassword', 'Temporäres Passwort')}:{' '}
              <code className="font-mono font-bold">{tempPassword}</code>
            </p>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
          <Mail className="w-4 h-4 text-rose-500" />
          {t('companies.portal.m365Title', 'M365 Tenant & Send-As')}
        </h3>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm space-y-1">
            <p>
              <span className="text-slate-500 font-semibold">Send-As / Graph:</span>{' '}
              <span className="font-bold text-slate-900">
                {emailSummary?.enabled
                  ? emailSummary.mailbox ||
                    t('companies.portal.channelConfigured', 'Konfiguriert')
                  : t('companies.portal.channelMissing', 'Nicht konfiguriert')}
              </span>
            </p>
            <p>
              <span className="text-slate-500 font-semibold">SSO:</span>{' '}
              <span className="font-bold text-slate-900">
                {emailSummary?.sso_enabled
                  ? t('companies.portal.ssoOn', 'Aktiv')
                  : t('companies.portal.ssoOff', 'Inaktiv')}
              </span>
              {emailSummary?.m365_tenant_id ? (
                <span className="text-xs text-slate-400 font-mono ml-2">
                  {emailSummary.m365_tenant_id}
                </span>
              ) : null}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onOpenEmailConfig}>
            {t('companies.portal.configureEmail', 'E-Mail & M365 konfigurieren')}
          </Button>
        </div>
      </section>
    </div>
  );
}
