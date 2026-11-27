import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  CheckCircle2,
  Info,
  Loader2,
  Mail,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { cn } from '../../../lib/utils';
import {
  clientPortalApi,
  type PortalEmailChannel,
  type PortalEmailOrgSettings,
} from '../../../services/clientPortalApi';
import {
  resolvePortalSettingsPaths,
  type PortalSettingsMode,
} from '../../../lib/client-portal/portal-settings-api-base';
import { OrgPortalBrandingCard } from '../../client-portal/OrgPortalBrandingCard';
import { EmailSignatureEditor } from '../../email/EmailSignatureEditor';
import { DEFAULT_HUBCOM_SIGNATURE_HTML } from '../../../lib/email-signature';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';

const MASK = '••••••••';

export type ClientEmailIntegrationPageProps = {
  mode?: PortalSettingsMode;
  organizationId?: string | null;
  embedded?: boolean;
  className?: string;
};

export default function ClientEmailIntegrationPage({
  mode = 'portal',
  organizationId = null,
  embedded = false,
  className,
}: ClientEmailIntegrationPageProps = {}) {
  const { session } = useClientPortalSession();
  const orgIdKey = String(organizationId || '').trim();
  const paths = useMemo(() => {
    try {
      return resolvePortalSettingsPaths(mode, organizationId);
    } catch {
      return null;
    }
  }, [mode, orgIdKey]);
  const emailGet = paths?.emailGet ?? '';
  const brandingGet = paths?.brandingGet ?? '';
  const fetchGenRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingSso, setSavingSso] = useState(false);
  const [savingSecondLevel, setSavingSecondLevel] = useState(false);
  const [testingSecondLevel, setTestingSecondLevel] = useState(false);
  const [secondLevelEnabled, setSecondLevelEnabled] = useState(false);
  const [secondLevelEmails, setSecondLevelEmails] = useState('');
  const [secondLevelLabel, setSecondLevelLabel] = useState('2nd-Level-Support');
  const [signature, setSignature] = useState({
    signature_enabled: true,
    signature_html: DEFAULT_HUBCOM_SIGNATURE_HTML,
    signature_logo_data: null as string | null,
    signature_logo_mime: null as string | null,
  });

  const [supportEmail, setSupportEmail] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [hasClientSecret, setHasClientSecret] = useState(false);
  const [secretDirty, setSecretDirty] = useState(false);
  const [inboundEnabled, setInboundEnabled] = useState(true);
  const [sendAsEnabled, setSendAsEnabled] = useState(false);

  const [channelMeta, setChannelMeta] = useState<PortalEmailChannel | null>(null);
  const [org, setOrg] = useState<PortalEmailOrgSettings | null>(null);
  const [m365TenantId, setM365TenantId] = useState('');
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoApprovalMode, setSsoApprovalMode] = useState<
    'admin_approval' | 'pre_provisioned_only' | 'auto_domain'
  >('admin_approval');
  const [branding, setBranding] = useState<{
    name: string;
    logo_url: string | null;
    portal_title: string | null;
  } | null>(null);

  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!emailGet) return;
      const gen = ++fetchGenRef.current;
      setLoading(true);
      try {
        const data =
          mode === 'portal'
            ? await clientPortalApi.getEmailChannel()
            : await (async () => {
                const res = await axios.get(emailGet, {
                  withCredentials: true,
                  signal,
                });
                return {
                  channel: res.data?.channel || null,
                  organization: res.data?.organization || null,
                };
              })();
        if (signal?.aborted || gen !== fetchGenRef.current) return;
        const ch = data.channel;
        setChannelMeta(ch);
        setSupportEmail(ch?.mailbox || ch?.email || '');
        setTenantId(ch?.tenantId || '');
        setClientId(ch?.clientId || '');
        setHasClientSecret(Boolean(ch?.hasClientSecret));
        setClientSecret(ch?.hasClientSecret ? MASK : '');
        setSecretDirty(false);
        setInboundEnabled(ch?.inboundEnabled !== false);
        setSendAsEnabled(Boolean(ch?.sendAsEnabled));
        setOrg(data.organization);
        setM365TenantId(data.organization?.m365TenantId || '');
        setSsoEnabled(Boolean(data.organization?.ssoEnabled));
        setSsoApprovalMode(data.organization?.ssoApprovalMode || 'admin_approval');
        const sl =
          data.organization?.secondLevelNotify ||
          ({
            second_level_notify_enabled: Boolean(
              data.organization?.second_level_notify_enabled,
            ),
            second_level_support_emails: data.organization?.second_level_support_emails || [],
            second_level_label:
              data.organization?.second_level_label || '2nd-Level-Support',
          } as const);
        setSecondLevelEnabled(Boolean(sl.second_level_notify_enabled));
        setSecondLevelEmails(
          Array.isArray(sl.second_level_support_emails)
            ? sl.second_level_support_emails.join(', ')
            : '',
        );
        setSecondLevelLabel(sl.second_level_label || '2nd-Level-Support');
        if (ch) {
          setSignature({
            signature_enabled: ch.signature_enabled !== false,
            signature_html: ch.signature_html || DEFAULT_HUBCOM_SIGNATURE_HTML,
            signature_logo_data: ch.signature_logo_data || null,
            signature_logo_mime: ch.signature_logo_mime || null,
          });
        }
        try {
          const brandUrl = mode === 'portal' ? '/api/portal/organization' : brandingGet;
          if (brandUrl) {
            const brandRes = await axios.get(brandUrl, {
              withCredentials: true,
              signal,
            });
            if (signal?.aborted || gen !== fetchGenRef.current) return;
            const o = brandRes.data?.organization || brandRes.data?.branding;
            if (o) {
              setBranding({
                name: o.name || data.organization?.name || '',
                logo_url: o.logo_url || null,
                portal_title: o.portal_title || null,
              });
            }
          }
        } catch (brandErr: any) {
          if (
            signal?.aborted ||
            brandErr?.code === 'ERR_CANCELED' ||
            brandErr?.name === 'CanceledError'
          ) {
            return;
          }
          /* branding optional on this page */
        }
        if (ch?.lastTestOk != null) {
          setTestResult({
            ok: Boolean(ch.lastTestOk),
            message: ch.lastError || (ch.lastTestOk ? 'Zuletzt erfolgreich getestet.' : ''),
          });
        }
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
        toast.error(err?.response?.data?.error || 'E-Mail-Kanal konnte nicht geladen werden.');
      } finally {
        if (gen === fetchGenRef.current && !signal?.aborted) setLoading(false);
      }
    },
    [mode, emailGet, brandingGet],
  );

  useEffect(() => {
    if (!emailGet) {
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
  }, [mode, orgIdKey, emailGet]);

  const handleSave = async () => {
    if (!supportEmail.trim() || !supportEmail.includes('@')) {
      toast.error('Bitte eine gültige Support-E-Mail angeben.');
      return;
    }
    if (!tenantId.trim() || !clientId.trim()) {
      toast.error('Directory (Tenant)-ID und Application (Client)-ID sind erforderlich.');
      return;
    }
    if (!hasClientSecret && !clientSecret.trim()) {
      toast.error('Client-Secret ist erforderlich.');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        email: supportEmail.trim(),
        mailbox: supportEmail.trim(),
        tenantId: tenantId.trim(),
        clientId: clientId.trim(),
        inboundEnabled,
        sendAsEnabled,
        signature_enabled: signature.signature_enabled,
        signature_html: signature.signature_html,
        signature_logo_data: signature.signature_logo_data,
        signature_logo_mime: signature.signature_logo_mime,
      };
      if (secretDirty && clientSecret && clientSecret !== MASK) {
        payload.clientSecret = clientSecret;
      }
      if (mode === 'portal') {
        const channel = await clientPortalApi.saveEmailChannel(payload);
        setChannelMeta(channel);
        setHasClientSecret(Boolean(channel.hasClientSecret));
        setClientSecret(channel.hasClientSecret ? MASK : '');
      } else if (paths) {
        const res = await axios.put(paths.emailPut, payload, { withCredentials: true });
        const channel = res.data?.channel;
        setChannelMeta(channel);
        setHasClientSecret(Boolean(channel?.hasClientSecret));
        setClientSecret(channel?.hasClientSecret ? MASK : '');
        if (res.data?.organization) setOrg(res.data.organization);
      }
      setSecretDirty(false);
      toast.success('E-Mail-Kanal gespeichert.');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload: Record<string, unknown> = {
        email: supportEmail.trim(),
        mailbox: supportEmail.trim(),
        tenantId: tenantId.trim(),
        clientId: clientId.trim(),
      };
      if (secretDirty && clientSecret && clientSecret !== MASK) {
        payload.clientSecret = clientSecret;
      }
      const result =
        mode === 'portal'
          ? await clientPortalApi.testEmailChannel(payload)
          : await (async () => {
              const res = await axios.post(paths!.emailTest, payload, {
                withCredentials: true,
              });
              return {
                ok: Boolean(res.data?.ok ?? res.data?.success),
                message: res.data?.message || res.data?.error || '',
              };
            })();
      setTestResult({ ok: result.ok, message: result.message });
      if (result.ok) toast.success('Verbindung erfolgreich.');
      else toast.error(result.message || 'Verbindungstest fehlgeschlagen.');
      await load();
    } catch (err: any) {
      const message =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        'Verbindungstest fehlgeschlagen.';
      setTestResult({ ok: false, message });
      toast.error(message);
    } finally {
      setTesting(false);
    }
  };

  const handleSaveSso = async () => {
    setSavingSso(true);
    try {
      let updated: PortalEmailOrgSettings | null = null;
      if (mode === 'portal') {
        updated = await clientPortalApi.updateEmailSso({
          m365TenantId: m365TenantId.trim() || null,
          ssoEnabled,
          ssoApprovalMode,
        });
      } else if (paths) {
        const res = await axios.put(
          paths.emailPut,
          {
            m365TenantId: m365TenantId.trim() || null,
            ssoEnabled,
            ssoApprovalMode,
          },
          { withCredentials: true },
        );
        updated = res.data?.organization || null;
      }
      setOrg(updated);
      setM365TenantId(updated?.m365TenantId || '');
      setSsoEnabled(Boolean(updated?.ssoEnabled));
      setSsoApprovalMode(updated?.ssoApprovalMode || 'admin_approval');
      toast.success('SSO-Einstellungen gespeichert.');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'SSO konnte nicht gespeichert werden.');
    } finally {
      setSavingSso(false);
    }
  };

  const handleSaveSecondLevel = async () => {
    setSavingSecondLevel(true);
    try {
      let updated: PortalEmailOrgSettings | null = null;
      if (mode === 'portal') {
        updated = await clientPortalApi.updateSecondLevelNotify({
          second_level_notify_enabled: secondLevelEnabled,
          second_level_support_emails: secondLevelEmails,
          second_level_label: secondLevelLabel.trim() || '2nd-Level-Support',
        });
      } else if (paths) {
        const res = await axios.put(
          paths.emailPut,
          {
            second_level_notify_enabled: secondLevelEnabled,
            second_level_support_emails: secondLevelEmails,
            second_level_label: secondLevelLabel.trim() || '2nd-Level-Support',
          },
          { withCredentials: true },
        );
        updated = res.data?.organization || null;
      }
      const sl = updated?.secondLevelNotify || {
        second_level_notify_enabled: Boolean(updated?.second_level_notify_enabled),
        second_level_support_emails: updated?.second_level_support_emails || [],
        second_level_label: updated?.second_level_label || '2nd-Level-Support',
      };
      setSecondLevelEnabled(Boolean(sl.second_level_notify_enabled));
      setSecondLevelEmails(
        Array.isArray(sl.second_level_support_emails)
          ? sl.second_level_support_emails.join(', ')
          : '',
      );
      setSecondLevelLabel(sl.second_level_label || '2nd-Level-Support');
      if (updated) setOrg((prev) => (prev ? { ...prev, ...updated } : updated));
      toast.success('2nd-Level-Support Benachrichtigungen gespeichert.');
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error ||
          '2nd-Level-Einstellungen konnten nicht gespeichert werden.',
      );
    } finally {
      setSavingSecondLevel(false);
    }
  };

  const handleTestSecondLevel = async () => {
    setTestingSecondLevel(true);
    try {
      // Persist current draft first so the test uses the addresses on screen.
      if (mode === 'portal') {
        await clientPortalApi.updateSecondLevelNotify({
          second_level_notify_enabled: secondLevelEnabled,
          second_level_support_emails: secondLevelEmails,
          second_level_label: secondLevelLabel.trim() || '2nd-Level-Support',
        });
        const result = await clientPortalApi.sendSecondLevelTestEmail({
          to: secondLevelEmails,
        });
        if (result.ok) toast.success(result.message || 'Test-E-Mail gesendet.');
        else toast.error(result.message || 'Test-E-Mail fehlgeschlagen.');
      } else if (paths) {
        await axios.put(
          paths.emailPut,
          {
            second_level_notify_enabled: secondLevelEnabled,
            second_level_support_emails: secondLevelEmails,
            second_level_label: secondLevelLabel.trim() || '2nd-Level-Support',
          },
          { withCredentials: true },
        );
        toast.success('2nd-Level-Einstellungen gespeichert (Admin — Test-Mail über Portal).');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Test-E-Mail fehlgeschlagen.');
    } finally {
      setTestingSecondLevel(false);
    }
  };

  if (mode === 'admin' && !paths) {
    return (
      <div className="p-10 text-center text-sm text-slate-500">
        Organisation nicht ausgewählt.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className={embedded ? `space-y-6 ${className || ''}` : `max-w-3xl mx-auto p-6 lg:p-10 space-y-8 ${className || ''}`}>
      {!embedded ? (
        <div>
          <h1 className="text-2xl font-black tracking-tight">E-Mail & M365 Integration</h1>
          <p className="text-sm text-slate-500 mt-1">
            Verbinden Sie Ihr Microsoft-365-Postfach für eingehende Tickets und Send-As-Antworten
            {org?.name ? ` (${org.name})` : ''}.
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-500 font-medium">
          M365/SMTP-Anbindung, Entra-ID-Tenant, SSO-Freigabe und 2nd-Level-Support für diese Organisation.
        </p>
      )}

      {!embedded && branding ? (
        <OrgPortalBrandingCard
          organizationName={branding.name || org?.name || 'Organisation'}
          logoUrl={branding.logo_url}
          portalTitle={branding.portal_title}
          onSave={async (payload) => {
            const res = await axios.put((paths?.brandingPut || '/api/portal/organization/branding'), payload, {
              withCredentials: true,
            });
            const o = res.data?.organization;
            if (o) {
              setBranding({
                name: o.name || branding.name,
                logo_url: o.logo_url || null,
                portal_title: o.portal_title || null,
              });
            }
          }}
        />
      ) : null}

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <EmailSignatureEditor
          value={signature}
          onChange={setSignature}
          previewAgent={{
            name: session?.name || session?.email || 'CLIENT_ADMIN',
            email: session?.email || undefined,
          }}
          organizationName={org?.name || branding?.name || 'Organisation'}
          saving={saving}
        />
        <p className="text-[11px] text-slate-400 mt-3">
          Signatur-Änderungen werden mit „E-Mail-Kanal speichern“ übernommen.
        </p>
      </div>

      {/* Setup helper */}
      <div className="rounded-2xl border border-sky-100 bg-sky-50/70 px-5 py-4 space-y-3">
        <div className="flex items-start gap-2.5">
          <Info className="w-4 h-4 text-sky-700 mt-0.5 shrink-0" />
          <div className="text-sm text-sky-950 space-y-2">
            <p className="font-bold">Entra-ID App-Registrierung</p>
            <p className="leading-relaxed text-sky-900/90">
              Legen Sie in Azure Portal eine App-Registrierung an und erteilen Sie die
              Anwendungsberechtigungen (Application permissions) mit Admin Consent:
            </p>
            <ul className="list-disc list-inside space-y-1 font-mono text-[13px]">
              <li>Mail.ReadWrite</li>
              <li>Mail.Send</li>
            </ul>
            <p className="text-sky-900/80 leading-relaxed">
              Authentifizierung erfolgt serverseitig per Client Credentials — kein Browser-OAuth,
              kein CORS-Problem beim Verbindungstest.
            </p>
          </div>
        </div>
      </div>

      {/* Graph channel form */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-sky-50 text-sky-700 flex items-center justify-center">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Microsoft Graph Postfach</h2>
            <p className="text-sm text-slate-500 mt-1">
              Support-Adresse, die Hubcom für Ihr Unternehmen abruft und als Absender nutzt.
            </p>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="support-email">Support-E-Mail (Send-As)</Label>
            <Input
              id="support-email"
              type="email"
              placeholder="it@kunde-a.de"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tenant-id">Directory (Tenant)-ID</Label>
            <Input
              id="tenant-id"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              autoComplete="off"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-id">Application (Client)-ID</Label>
            <Input
              id="client-id"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-secret">Client-Secret</Label>
            <Input
              id="client-secret"
              type="password"
              placeholder={hasClientSecret ? 'Gespeichertes Secret beibehalten' : 'Client Secret'}
              value={clientSecret}
              onChange={(e) => {
                setClientSecret(e.target.value);
                setSecretDirty(true);
              }}
              onFocus={() => {
                if (!secretDirty && clientSecret === MASK) {
                  setClientSecret('');
                  setSecretDirty(true);
                }
              }}
              autoComplete="new-password"
            />
            {hasClientSecret && !secretDirty ? (
              <p className="text-xs text-slate-400">Secret ist gespeichert (verschlüsselt) und wird nicht angezeigt.</p>
            ) : null}
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">Eingehende E-Mails abrufen</p>
              <p className="text-xs text-slate-500">Ungelesene Mails werden als Tickets Ihrer Organisation angelegt.</p>
            </div>
            <Switch checked={inboundEnabled} onCheckedChange={setInboundEnabled} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Antworten über eigenes Postfach senden (Send As)
              </p>
              <p className="text-xs text-slate-500">
                Agenten-Antworten gehen von Ihrer Support-Adresse; sonst Fallback auf hubcom.support@hubcom.de.
              </p>
            </div>
            <Switch checked={sendAsEnabled} onCheckedChange={setSendAsEnabled} />
          </div>
        </div>

        {testResult ? (
          <div
            className={cn(
              'rounded-xl px-4 py-3 flex items-start gap-2.5 text-sm',
              testResult.ok
                ? 'bg-emerald-50 border border-emerald-100 text-emerald-900'
                : 'bg-rose-50 border border-rose-100 text-rose-900',
            )}
          >
            {testResult.ok ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span className="leading-relaxed">{testResult.message}</span>
          </div>
        ) : null}

        {channelMeta?.status ? (
          <p className="text-xs text-slate-400">
            Status: <span className="font-semibold text-slate-600">{channelMeta.status}</span>
            {channelMeta.lastTestAt
              ? ` · letzter Test ${new Date(channelMeta.lastTestAt).toLocaleString('de-DE')}`
              : ''}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" onClick={() => void handleSave()} disabled={saving || testing}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Speichern
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleTest()}
            disabled={testing || saving}
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Verbindung testen
          </Button>
        </div>
      </div>

      {/* 2nd-Level-Support notifications */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">2nd-Level-Support Benachrichtigungen</h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              Automatische, formatierte E-Mail an Ihr 2nd-Level-Team, sobald ein Ticket auf
              2nd-Level-Support eskaliert / zugewiesen wird.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              Automatische E-Mail bei Zuweisung an 2nd-Level-Support
            </p>
            <p className="text-xs text-slate-500">
              Nur beim Wechsel auf 2nd-Level — keine Doppelmails bei späteren Edits.
            </p>
          </div>
          <Switch
            checked={secondLevelEnabled}
            onCheckedChange={setSecondLevelEnabled}
            aria-label="2nd-Level-Support Benachrichtigungen"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="second-level-emails">2nd-Level-Support E-Mail-Adresse(n)</Label>
          <Input
            id="second-level-emails"
            placeholder="2ndlevel@dpg-gruppe.de, escalation@dpg-gruppe.de"
            value={secondLevelEmails}
            onChange={(e) => setSecondLevelEmails(e.target.value)}
            className="text-sm"
            autoComplete="off"
          />
          <p className="text-[11px] text-slate-400">
            Eine oder mehrere Adressen, getrennt durch Komma.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="second-level-label">Bezeichnung (optional)</Label>
          <Input
            id="second-level-label"
            value={secondLevelLabel}
            onChange={(e) => setSecondLevelLabel(e.target.value)}
            className="text-sm"
            maxLength={80}
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            onClick={() => void handleSaveSecondLevel()}
            disabled={savingSecondLevel || testingSecondLevel}
          >
            {savingSecondLevel ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Speichern
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleTestSecondLevel()}
            disabled={testingSecondLevel || savingSecondLevel}
          >
            {testingSecondLevel ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Test-E-Mail senden
          </Button>
        </div>
      </div>

      {/* Optional SSO */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Microsoft 365 SSO (optional)</h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              Verknüpfen Sie Ihre Entra-ID-Tenant-ID, damit vorab angelegte oder domain-passende
              Benutzer sich mit Microsoft 365 anmelden und im eigenen Kunden-Portal landen.
              Unbekannte externe Tenants werden abgelehnt.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sso-tenant">M365 Tenant-ID (SSO)</Label>
          <Input
            id="sso-tenant"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={m365TenantId}
            onChange={(e) => setM365TenantId(e.target.value)}
            className="font-mono text-sm"
            autoComplete="off"
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-800">SSO aktivieren</p>
            <p className="text-xs text-slate-500">Nur für diesen verknüpften Tenant zulassen.</p>
          </div>
          <Switch checked={ssoEnabled} onCheckedChange={setSsoEnabled} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sso-approval-mode">Zugriffsmodus für neue M365-Benutzer</Label>
          <div className="space-y-2">
            {(
              [
                {
                  id: 'admin_approval' as const,
                  title: 'Admin-Freigabe erforderlich (Empfohlen)',
                  desc: 'Neue M365-Benutzer erscheinen unter Mitarbeiter & Rollen als Anfrage, bis ein Admin Rolle und Zugang freigibt.',
                },
                {
                  id: 'pre_provisioned_only' as const,
                  title: 'Nur vorab angelegte Benutzer',
                  desc: 'Nur Personen, die bereits in Mitarbeiter & Rollen angelegt sind, können sich per M365 anmelden.',
                },
                {
                  id: 'auto_domain' as const,
                  title: 'Automatisch für verknüpften Tenant',
                  desc: 'Legacy: Benutzer aus dem verknüpften Tenant werden automatisch als Benutzer freigeschaltet.',
                },
              ] as const
            ).map((opt) => (
              <label
                key={opt.id}
                className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  ssoApprovalMode === opt.id
                    ? 'border-emerald-300 bg-emerald-50/60'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="sso-approval-mode"
                  id={opt.id === 'admin_approval' ? 'sso-approval-mode' : undefined}
                  className="mt-1"
                  checked={ssoApprovalMode === opt.id}
                  onChange={() => setSsoApprovalMode(opt.id)}
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{opt.title}</span>
                  <span className="block text-xs text-slate-500 mt-0.5 leading-relaxed">{opt.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <Button type="button" variant="outline" onClick={() => void handleSaveSso()} disabled={savingSso}>
          {savingSso ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          SSO speichern
        </Button>
      </div>
    </div>
  );
}
