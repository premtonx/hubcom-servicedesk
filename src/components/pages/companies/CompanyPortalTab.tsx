import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { KeyRound, Loader2, Mail, Shield, Trash2, UserPlus, Users } from 'lucide-react';
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
import { HardwareReturnsModuleCard } from '../../client-portal/HardwareReturnsModuleCard';
import { DeletePortalUserDialog } from '../../ui/DeletePortalUserDialog';
import { useTranslation } from '../../../lib/context/I18nContext';

interface PortalUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  isDeactivated?: boolean;
  invitationStatus?: string;
  invitationEmailReason?: string | null;
}

type PortalRole = 'CLIENT_ADMIN' | 'CLIENT_SUPPORTER' | 'CLIENT_USER';

interface CompanyPortalTabProps {
  organizationId: string | null | undefined;
  companyName: string;
  onOpenEmailConfig?: () => void;
  /** When true, scroll/focus the invite form (e.g. header quick action). */
  focusInvite?: boolean;
}

function invitationLabel(status?: string): { text: string; className: string } {
  switch (status) {
    case 'sent':
      return { text: 'Einladung gesendet', className: 'bg-sky-50 text-sky-800 border-sky-200' };
    case 'pending':
      return { text: 'Einladung ausstehend', className: 'bg-amber-50 text-amber-900 border-amber-200' };
    case 'accepted':
      return { text: 'Aktiv', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
    case 'expired':
      return { text: 'Einladung abgelaufen', className: 'bg-rose-50 text-rose-800 border-rose-200' };
    case 'failed':
      return { text: 'E-Mail fehlgeschlagen', className: 'bg-rose-50 text-rose-800 border-rose-200' };
    default:
      return { text: status || '—', className: 'bg-slate-50 text-slate-700 border-slate-200' };
  }
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
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [hardwareEnabled, setHardwareEnabled] = useState(false);
  const [hardwareConfig, setHardwareConfig] = useState<Record<string, unknown> | null>(null);
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
  const [lastInviteResult, setLastInviteResult] = useState<{
    emailSent: boolean;
    emailReason?: string | null;
    setupLink?: string | null;
    invitationStatus?: string;
  } | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [setPasswordUser, setSetPasswordUser] = useState<PortalUserRow | null>(null);
  const [manualPassword, setManualPassword] = useState('');
  const [manualPasswordConfirm, setManualPasswordConfirm] = useState('');
  const [manualConfirm, setManualConfirm] = useState(false);
  const [deleteUser, setDeleteUser] = useState<PortalUserRow | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      setBannerUrl(org?.portal_banner_url || null);
      setHardwareEnabled(Boolean(org?.hardware_returns_enabled));
      setHardwareConfig(org?.hardware_returns_config || null);
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
      toast.error(t('admin.orgs.inviteRequired', 'Name und E-Mail sind erforderlich.'));
      return;
    }
    setSaving(true);
    setLastInviteResult(null);
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
      const emailSent = Boolean(res.data?.emailSent);
      const emailReason = res.data?.emailReason || null;
      setLastInviteResult({
        emailSent,
        emailReason,
        setupLink: res.data?.setupLink || null,
        invitationStatus: res.data?.invitationStatus,
      });
      setInviteName('');
      setInviteEmail('');
      if (emailSent) {
        toast.success(
          t(
            'companies.portal.invitedSent',
            'Einladung an {{email}} gesendet.',
          ).replace('{{email}}', String(res.data?.user?.email || '')),
        );
      } else {
        toast.error(
          t(
            'companies.portal.inviteMailFailed',
            'Benutzer angelegt, aber E-Mail konnte nicht gesendet werden.',
          ) + (emailReason ? ` (${emailReason})` : ''),
        );
      }
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

  const resendInvite = async (userId: string) => {
    if (!organizationId) return;
    setBusyUserId(userId);
    setLastInviteResult(null);
    try {
      const res = await axios.post(
        `/api/admin/organizations/${encodeURIComponent(organizationId)}/users/${encodeURIComponent(userId)}/reset-password`,
        {},
        { withCredentials: true },
      );
      const emailSent = Boolean(res.data?.emailSent);
      setLastInviteResult({
        emailSent,
        emailReason: res.data?.emailReason || null,
        setupLink: res.data?.setupLink || null,
        invitationStatus: res.data?.invitationStatus,
      });
      if (emailSent) {
        toast.success(t('companies.portal.inviteResent', 'Einladungs-E-Mail erneut gesendet.'));
      } else {
        toast.error(
          t(
            'companies.portal.inviteMailFailed',
            'E-Mail konnte nicht gesendet werden.',
          ) + (res.data?.emailReason ? ` (${res.data.emailReason})` : ''),
        );
      }
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Erneutes Senden fehlgeschlagen');
    } finally {
      setBusyUserId(null);
    }
  };

  const submitManualPassword = async () => {
    if (!organizationId || !setPasswordUser) return;
    if (manualPassword.length < 10) {
      toast.error(t('companies.portal.passwordPolicy', 'Passwort: mindestens 10 Zeichen.'));
      return;
    }
    if (manualPassword !== manualPasswordConfirm) {
      toast.error(t('companies.portal.passwordMismatch', 'Passwörter stimmen nicht überein.'));
      return;
    }
    if (!manualConfirm) {
      toast.error(
        t('companies.portal.passwordConfirmRequired', 'Bitte Bestätigung aktivieren.'),
      );
      return;
    }
    setBusyUserId(setPasswordUser.id);
    try {
      await axios.post(
        `/api/admin/organizations/${encodeURIComponent(organizationId)}/users/${encodeURIComponent(setPasswordUser.id)}/set-password`,
        { password: manualPassword, confirm: true },
        { withCredentials: true },
      );
      toast.success(
        t('companies.portal.passwordSet', 'Passwort gesetzt (wird nicht erneut angezeigt).'),
      );
      setSetPasswordUser(null);
      setManualPassword('');
      setManualPasswordConfirm('');
      setManualConfirm(false);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Passwort setzen fehlgeschlagen');
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
          bannerUrl={bannerUrl}
          onSave={saveBranding}
          onBannerUpload={async (bannerDataUrl) => {
            const res = await axios.post(
              `/api/admin/organizations/${encodeURIComponent(organizationId)}/banner`,
              { bannerDataUrl },
              { withCredentials: true },
            );
            setBannerUrl(res.data?.organization?.portal_banner_url || bannerDataUrl);
          }}
          onBannerRemove={async () => {
            await axios.delete(
              `/api/admin/organizations/${encodeURIComponent(organizationId)}/banner`,
              { withCredentials: true },
            );
            setBannerUrl(null);
          }}
        />
      </section>

      <HardwareReturnsModuleCard
        organizationId={organizationId}
        enabled={hardwareEnabled}
        config={hardwareConfig}
        onSaved={(next) => {
          setHardwareEnabled(next.hardware_returns_enabled);
          setHardwareConfig(next.hardware_returns_config);
        }}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-500" />
            {t('companies.portal.usersTitle', 'Portal-Benutzer & Admins')}
          </h3>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {users.length === 0 ? (
            <p className="p-6 text-sm text-slate-500" role="status">
              {t('companies.portal.noUsers', 'Noch keine Portal-Benutzer für dieses Unternehmen.')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {users.map((u) => {
                const inv = invitationLabel(u.invitationStatus);
                return (
                  <li
                    key={u.id}
                    className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{u.name || u.email}</p>
                      <p className="text-xs text-slate-500 truncate">{u.email}</p>
                      <span
                        className={`mt-1 inline-flex text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border ${inv.className}`}
                      >
                        {inv.text}
                      </span>
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
                        onClick={() => void resendInvite(u.id)}
                        title={t(
                          'companies.portal.resendInvite',
                          'Einladung / Passwort-Setup erneut senden',
                        )}
                      >
                        {busyUserId === u.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Mail className="w-3 h-3" />
                        )}
                        {t('companies.portal.resend', 'Erneut senden')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 text-[10px] font-bold"
                        disabled={busyUserId === u.id}
                        onClick={() => {
                          setSetPasswordUser(u);
                          setManualPassword('');
                          setManualPasswordConfirm('');
                          setManualConfirm(false);
                        }}
                        title={t(
                          'companies.portal.setPasswordManual',
                          'Passwort manuell setzen',
                        )}
                      >
                        <KeyRound className="w-3 h-3" />
                        {t('companies.portal.setPassword', 'Passwort')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 text-[10px] font-bold text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                        disabled={busyUserId === u.id || deleting}
                        onClick={() => setDeleteUser(u)}
                        title={t('companies.portal.deleteUser', 'Löschen')}
                      >
                        <Trash2 className="w-3 h-3" />
                        {t('companies.portal.delete', 'Löschen')}
                      </Button>
                      {u.isDeactivated ? (
                        <Badge variant="destructive" className="text-[10px]">
                          inactive
                        </Badge>
                      ) : null}
                    </div>
                  </li>
                );
              })}
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
          <p className="text-xs text-slate-600">
            {t(
              'companies.portal.inviteHint',
              'Sendet einen einmaligen, zeitlich begrenzten Einrichtungslink an die eingegebene E-Mail. Es wird kein Passwort angezeigt oder per E-Mail versendet.',
            )}
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
          {setPasswordUser ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <p className="text-xs font-bold text-slate-800">
                {t('companies.portal.setPasswordFor', 'Passwort setzen für')}{' '}
                {setPasswordUser.email}
              </p>
              <p className="text-[11px] text-slate-500">
                {t(
                  'companies.portal.setPasswordHint',
                  'Wird nicht per E-Mail versendet und nach dem Speichern nicht erneut angezeigt. Bevorzugt: Einladungslink erneut senden.',
                )}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase">Passwort</Label>
                  <Input
                    type="password"
                    value={manualPassword}
                    onChange={(e) => setManualPassword(e.target.value)}
                    minLength={10}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase">Bestätigen</Label>
                  <Input
                    type="password"
                    value={manualPasswordConfirm}
                    onChange={(e) => setManualPasswordConfirm(e.target.value)}
                    minLength={10}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={manualConfirm}
                  onChange={(e) => setManualConfirm(e.target.checked)}
                />
                {t(
                  'companies.portal.setPasswordConfirm',
                  'Ich bestätige das manuelle Setzen dieses Passworts.',
                )}
              </label>
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSetPasswordUser(null)}
                >
                  Abbrechen
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={busyUserId === setPasswordUser.id}
                  onClick={() => void submitManualPassword()}
                >
                  {busyUserId === setPasswordUser.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : null}
                  Speichern
                </Button>
              </div>
            </div>
          ) : null}

          {lastInviteResult ? (
            <div
              className={`text-xs rounded-lg px-3 py-2 border ${
                lastInviteResult.emailSent
                  ? 'text-emerald-900 bg-emerald-50 border-emerald-100'
                  : 'text-amber-900 bg-amber-50 border-amber-100'
              }`}
              role="status"
            >
              {lastInviteResult.emailSent
                ? t(
                    'companies.portal.inviteResultSent',
                    'Einladungs-E-Mail wurde über die konfigurierte Mail-Infrastruktur gesendet.',
                  )
                : t(
                    'companies.portal.inviteResultFailed',
                    'E-Mail-Versand fehlgeschlagen — Benutzer ist angelegt, aber nicht benachrichtigt.',
                  )}
              {lastInviteResult.emailReason ? (
                <span className="block mt-1 font-mono text-[11px] opacity-80">
                  {lastInviteResult.emailReason}
                </span>
              ) : null}
              {!lastInviteResult.emailSent && lastInviteResult.setupLink ? (
                <span className="block mt-2 break-all">
                  {t(
                    'companies.portal.manualSetupLink',
                    'Autorisierter Setup-Link (nur bei Versandfehler, einmalig):',
                  )}{' '}
                  <code className="font-mono text-[11px]">{lastInviteResult.setupLink}</code>
                </span>
              ) : null}
            </div>
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

      <DeletePortalUserDialog
        open={Boolean(deleteUser)}
        name={deleteUser?.name || ''}
        email={deleteUser?.email || ''}
        busy={deleting}
        onCancel={() => setDeleteUser(null)}
        onConfirm={async () => {
          if (!organizationId || !deleteUser) return;
          setDeleting(true);
          try {
            await axios.delete(
              `/api/admin/organizations/${encodeURIComponent(organizationId)}/users/${encodeURIComponent(deleteUser.id)}`,
              { withCredentials: true },
            );
            toast.success(
              t(
                'companies.portal.userDeleted',
                `Portal-Benutzer entfernt: ${deleteUser.name || deleteUser.email}`,
              ),
            );
            setDeleteUser(null);
            await load();
          } catch (err: any) {
            toast.error(err?.response?.data?.error || 'Löschen fehlgeschlagen');
          } finally {
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}
