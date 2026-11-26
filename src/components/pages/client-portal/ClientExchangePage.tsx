import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Copy,
  Loader2,
  Lock,
  Plus,
  Shield,
  Trash2,
  X,
} from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { cn } from '../../../lib/utils';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';
import {
  evaluatePortalExchangePageAccess,
  resolveSecureExchangeModuleFlag,
} from '../../../lib/client-portal/portal-modules-nav';

type ExchangeItem = {
  id: string;
  type: string;
  expiresAt: string | null;
  maxViews: number | null;
  viewCount: number;
  isBurned: boolean;
  createdAt: string | null;
  createdBy: string | null;
  organizationId: string | null;
  passphraseRequired?: boolean;
  metadata?: {
    secretType?: string | null;
    description?: string | null;
    recipientEmails?: string[];
    maxViews?: number | null;
  };
};

function isExpired(item: ExchangeItem): boolean {
  if (item.isBurned) return true;
  if (item.expiresAt && new Date(item.expiresAt).getTime() < Date.now()) return true;
  if (
    item.maxViews != null &&
    Number.isFinite(item.maxViews) &&
    item.viewCount >= Number(item.maxViews)
  ) {
    return true;
  }
  return false;
}

function formatExpiry(item: ExchangeItem): string {
  if (!item.expiresAt) return 'Ohne Zeitlimit';
  return new Date(item.expiresAt).toLocaleString('de-DE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ClientExchangePage() {
  const { session, isClient, isOrgWide, loading: sessionLoading } = useClientPortalSession();
  const [items, setItems] = useState<ExchangeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleEnabled, setModuleEnabled] = useState<boolean | null>(null);
  const [moduleLoading, setModuleLoading] = useState(true);
  const [tab, setTab] = useState<'active' | 'expired'>('active');
  const [composerOpen, setComposerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState('');
  const [secretType, setSecretType] = useState('Zugangsdaten');
  const [maxViews, setMaxViews] = useState(1);
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [passphrase, setPassphrase] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  useEffect(() => {
    if (sessionLoading) return;
    if (!session?.organizationId) {
      setModuleEnabled(false);
      setModuleLoading(false);
      return;
    }
    let active = true;
    setModuleLoading(true);
    void axios
      .get('/api/portal/me', { withCredentials: true })
      .then((res) => {
        if (!active) return;
        setModuleEnabled(resolveSecureExchangeModuleFlag(res.data));
      })
      .catch(() => {
        if (active) setModuleEnabled(false);
      })
      .finally(() => {
        if (active) setModuleLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.organizationId, sessionLoading]);

  const gate = evaluatePortalExchangePageAccess({
    sessionLoading,
    moduleLoading,
    isClient,
    moduleEnabled,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/portal/exchange', { withCredentials: true });
      setItems(Array.isArray(res.data?.items) ? res.data.items : []);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Transfers konnten nicht geladen werden.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (gate.action !== 'allow') return;
    void load();
  }, [load, gate.action]);

  const { active, expired } = useMemo(() => {
    const a: ExchangeItem[] = [];
    const e: ExchangeItem[] = [];
    for (const item of items) {
      if (isExpired(item)) e.push(item);
      else a.push(item);
    }
    return { active: a, expired: e };
  }, [items]);

  const listed = tab === 'active' ? active : expired;

  if (gate.action === 'spinner') {
    return (
      <div className="p-10 flex justify-center" aria-busy="true" aria-label="Laden">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
      </div>
    );
  }

  if (gate.action === 'redirect') {
    return <Navigate to={gate.to || '/portal/dashboard'} replace />;
  }

  const createTransfer = async () => {
    if (!content.trim()) {
      toast.error('Bitte Inhalt eingeben.');
      return;
    }
    setSaving(true);
    try {
      const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
      const res = await axios.post(
        '/api/portal/exchange',
        {
          content: content.trim(),
          secretType: secretType.trim() || 'Text',
          maxViews: Math.max(1, maxViews),
          expiresAt,
          passphrase: passphrase.trim() || undefined,
          recipientEmails: recipientEmail.trim()
            ? [recipientEmail.trim().toLowerCase()]
            : undefined,
        },
        { withCredentials: true },
      );
      const sharePath = res.data?.sharePath || (res.data?.item?.id ? `/v/${res.data.item.id}` : '');
      if (sharePath) {
        const url = `${window.location.origin}${sharePath}`;
        await navigator.clipboard.writeText(url).catch(() => undefined);
        toast.success('Transfer erstellt — Link in die Zwischenablage kopiert.');
      } else {
        toast.success('Transfer erstellt.');
      }
      setComposerOpen(false);
      setContent('');
      setPassphrase('');
      setRecipientEmail('');
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Transfer fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async (id: string) => {
    const url = `${window.location.origin}/v/${id}`;
    await navigator.clipboard.writeText(url);
    toast.success('Link kopiert.');
  };

  const reveal = async (id: string) => {
    try {
      const res = await axios.post(
        `/api/portal/exchange/${encodeURIComponent(id)}/reveal`,
        {},
        { withCredentials: true },
      );
      const text = String(res.data?.content || '');
      setRevealed((prev) => ({ ...prev, [id]: text }));
      if (res.data?.burned) toast.info('Transfer nach Abruf vernichtet.');
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Abruf fehlgeschlagen.');
    }
  };

  const revoke = async (id: string) => {
    if (!confirm('Transfer wirklich widerrufen?')) return;
    try {
      await axios.post(
        `/api/portal/exchange/${encodeURIComponent(id)}/revoke`,
        {},
        { withCredentials: true },
      );
      toast.success('Transfer widerrufen.');
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Widerruf fehlgeschlagen.');
    }
  };

  const canRevoke = (item: ExchangeItem) => {
    if (isOrgWide) return true;
    return item.createdBy === session?.id;
  };

  return (
    <div className="flex-1 overflow-y-auto min-h-0 bg-[#F8F9FA]">
      <div className="max-w-[1100px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4 pb-20">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-slate-900">
                Sicherer Austausch
              </h1>
              <p className="text-sm text-slate-500 font-medium">
                Verschlüsselte Transfers für Ihre Organisation
              </p>
            </div>
          </div>
          <Button
            className="h-9 rounded-xl gap-1.5 bg-[#1B6CA8] hover:bg-[#155a8a] text-white font-bold"
            onClick={() => setComposerOpen(true)}
          >
            <Plus className="w-4 h-4" />
            Neuer Transfer
          </Button>
        </header>

        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 w-fit">
          {(
            [
              { id: 'active' as const, label: `Aktiv (${active.length})` },
              { id: 'expired' as const, label: `Abgelaufen (${expired.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'px-3 py-1.5 text-xs font-bold rounded-lg',
                tab === t.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              Transfers werden geladen…
            </div>
          ) : listed.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-sm">Keine Transfers.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {listed.map((item) => (
                <li key={item.id} className="p-4 sm:p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Lock className="w-4 h-4 text-emerald-600 shrink-0" />
                        <p className="text-sm font-bold text-slate-900">
                          {item.metadata?.secretType || 'Verschlüsselter Transfer'}
                        </p>
                      </div>
                      <p className="text-[11px] text-slate-500 font-medium mt-1">
                        Ablauf: {formatExpiry(item)}
                        {item.maxViews != null
                          ? ` · Aufrufe ${item.viewCount}/${item.maxViews}`
                          : ` · Aufrufe ${item.viewCount}`}
                        {item.passphraseRequired ? ' · Passphrase' : ''}
                      </p>
                      {revealed[item.id] ? (
                        <pre className="mt-2 text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 whitespace-pre-wrap break-all font-mono">
                          {revealed[item.id]}
                        </pre>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      {!isExpired(item) ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => void copyLink(item.id)}
                          >
                            <Copy className="w-3.5 h-3.5" />
                            Link
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => void reveal(item.id)}
                          >
                            Anzeigen
                          </Button>
                          {canRevoke(item) ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 text-rose-600 border-rose-200"
                              onClick={() => void revoke(item.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Widerrufen
                            </Button>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider self-center">
                          Abgelaufen
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {composerOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">Neuer sicherer Transfer</h3>
              <button type="button" onClick={() => setComposerOpen(false)} aria-label="Schließen">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold">Bezeichnung</Label>
              <Input value={secretType} onChange={(e) => setSecretType(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold">Inhalt (Text / Zugangsdaten)</Label>
              <textarea
                className="w-full min-h-[120px] rounded-xl border border-slate-200 p-3 text-sm font-mono"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs font-bold">Max. Aufrufe</Label>
                <select
                  className="w-full h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  value={maxViews}
                  onChange={(e) => setMaxViews(Number(e.target.value))}
                >
                  {[1, 2, 3, 5, 10].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? '1 (Einmalig)' : n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold">Ablauf</Label>
                <select
                  className="w-full h-9 rounded-lg border border-slate-200 px-2 text-sm"
                  value={expiresInHours}
                  onChange={(e) => setExpiresInHours(Number(e.target.value))}
                >
                  <option value={1}>1 Stunde</option>
                  <option value={4}>4 Stunden</option>
                  <option value={24}>24 Stunden</option>
                  <option value={72}>3 Tage</option>
                  <option value={168}>7 Tage</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold">Empfänger-E-Mail (optional)</Label>
              <Input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="kollege@firma.de"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold">Zusatz-Passphrase (optional)</Label>
              <Input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setComposerOpen(false)}>
                Abbrechen
              </Button>
              <Button
                className="bg-[#1B6CA8] hover:bg-[#155a8a] text-white font-bold"
                disabled={saving}
                onClick={() => void createTransfer()}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Erstellen
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
