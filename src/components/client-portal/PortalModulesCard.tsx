import { useEffect, useState } from 'react';
import { Loader2, Lock, Settings2, Shield } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { cn } from '../../lib/utils';

interface PortalModulesCardProps {
  /** Staff Admin-Hub: organization id. Portal CLIENT_ADMIN: omit (uses session org). */
  organizationId?: string | null;
  secureExchangeEnabled: boolean;
  vaultEnabled: boolean;
  /** 'admin' → PUT /api/admin/organizations/:id/portal-modules; 'portal' → /api/portal/organization/modules */
  mode: 'admin' | 'portal';
  onSaved?: (next: {
    secure_exchange_enabled: boolean;
    vault_enabled: boolean;
  }) => void;
  className?: string;
}

/**
 * Portal-Module toggles for Sicherer Austausch & Tresor.
 * Visible to CLIENT_ADMIN (portal branding) and Hubcom SYSTEM_ADMIN (Kunden portal tab).
 */
export function PortalModulesCard({
  organizationId,
  secureExchangeEnabled,
  vaultEnabled,
  mode,
  onSaved,
  className,
}: PortalModulesCardProps) {
  const [exchangeOn, setExchangeOn] = useState(Boolean(secureExchangeEnabled));
  const [vaultOn, setVaultOn] = useState(Boolean(vaultEnabled));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setExchangeOn(Boolean(secureExchangeEnabled));
    setVaultOn(Boolean(vaultEnabled));
  }, [secureExchangeEnabled, vaultEnabled, organizationId]);

  const save = async () => {
    if (mode === 'admin' && !organizationId) {
      toast.error('Organisation fehlt.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        secure_exchange_enabled: exchangeOn,
        vault_enabled: vaultOn,
      };
      const res =
        mode === 'admin'
          ? await axios.put(
              `/api/admin/organizations/${encodeURIComponent(organizationId!)}/portal-modules`,
              payload,
              { withCredentials: true },
            )
          : await axios.put('/api/portal/organization/modules', payload, {
              withCredentials: true,
            });
      const org = res.data?.organization;
      const nextExchange =
        org?.secure_exchange_enabled !== undefined
          ? Boolean(org.secure_exchange_enabled)
          : exchangeOn;
      const nextVault =
        org?.vault_enabled !== undefined ? Boolean(org.vault_enabled) : vaultOn;
      setExchangeOn(nextExchange);
      setVaultOn(nextVault);
      toast.success('Portal-Module gespeichert');
      onSaved?.({
        secure_exchange_enabled: nextExchange,
        vault_enabled: nextVault,
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    exchangeOn !== Boolean(secureExchangeEnabled) || vaultOn !== Boolean(vaultEnabled);

  return (
    <section
      className={cn(
        'rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-5',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
          <Settings2 className="w-4.5 h-4.5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-black text-slate-900">Portal-Module</h3>
          <p className="text-xs text-slate-500 font-medium mt-0.5 leading-relaxed">
            Sicherer Austausch und Tresor pro Kunde ein- oder ausschalten. Deaktivierte Module
            erscheinen nicht in der Portal-Navigation.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
          <div className="flex items-start gap-3 min-w-0">
            <Shield className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <Label htmlFor="portal-mod-exchange" className="text-sm font-bold text-slate-900">
                Sicherer Austausch
              </Label>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Einmalige Transfers und Secrets im Kunden-Portal.
              </p>
            </div>
          </div>
          <Switch
            id="portal-mod-exchange"
            checked={exchangeOn}
            onCheckedChange={setExchangeOn}
            aria-label="Sicherer Austausch aktivieren"
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
          <div className="flex items-start gap-3 min-w-0">
            <Lock className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <Label htmlFor="portal-mod-vault" className="text-sm font-bold text-slate-900">
                Tresor
              </Label>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Org-weite Zugangsdaten für Admins und Supporter.
              </p>
            </div>
          </div>
          <Switch
            id="portal-mod-vault"
            checked={vaultOn}
            onCheckedChange={setVaultOn}
            aria-label="Tresor aktivieren"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => void save()}
          disabled={saving || !dirty}
          className="gap-2"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Speichern
        </Button>
      </div>
    </section>
  );
}

export default PortalModulesCard;
