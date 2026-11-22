import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { cn } from '../../lib/utils';
import {
  userAdminApi,
  type AdminAuthMethod,
  type AdminRole,
  type AdminUser,
  type EntraSettingsDto,
} from '../../services/userAdminApi';

const ROLE_LABELS: Record<string, string> = {
  SYSTEM_ADMIN: 'Administrator',
  agent: 'Mitarbeiter',
  customer: 'Kunde',
  admin: 'Administrator',
  team_lead: 'Mitarbeiter',
};

function roleBadgeClass(role: string) {
  if (role === 'SYSTEM_ADMIN' || role === 'admin')
    return 'bg-indigo-50 text-indigo-800 border-indigo-100';
  if (role === 'customer') return 'bg-emerald-50 text-emerald-800 border-emerald-100';
  return 'bg-sky-50 text-sky-800 border-sky-100';
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type CreateForm = {
  name: string;
  email: string;
  kuerzel: string;
  role: AdminRole;
  company: string;
  authMethod: AdminAuthMethod;
  password: string;
};

const emptyCreate = (): CreateForm => ({
  name: '',
  email: '',
  kuerzel: '',
  role: 'agent',
  company: '',
  authMethod: 'password',
  password: '',
});

export default function UserManagementPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [passwordUser, setPasswordUser] = useState<AdminUser | null>(null);
  const [entraOpen, setEntraOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreate);
  const [editForm, setEditForm] = useState<Partial<AdminUser>>({});
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [entra, setEntra] = useState<EntraSettingsDto | null>(null);
  const [entraSecret, setEntraSecret] = useState('');
  const [domainsText, setDomainsText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { users: list } = await userAdminApi.list({
        q: search || undefined,
        role: roleFilter,
        authMethod: typeFilter,
        limit: 200,
      });
      setUsers(list);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || 'Benutzer konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, typeFilter]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
  }, [load]);

  const openEntra = async () => {
    try {
      const settings = await userAdminApi.getEntraSettings();
      setEntra(settings);
      setDomainsText((settings.allowedDomains || []).join(', '));
      setEntraSecret('');
      setEntraOpen(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Entra-Einstellungen nicht ladbar');
    }
  };

  const stats = useMemo(() => {
    const total = users.length;
    const m365 = users.filter((u) => u.authMethod === 'microsoft365').length;
    const local = total - m365;
    const active = users.filter((u) => !u.isDeactivated).length;
    return { total, m365, local, active };
  }, [users]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim() || !createForm.email.trim()) {
      toast.error('Name und E-Mail sind erforderlich.');
      return;
    }
    if (createForm.authMethod === 'password' && createForm.password.length < 8) {
      toast.error('Bitte ein Initialpasswort mit mindestens 8 Zeichen angeben.');
      return;
    }
    setSaving(true);
    try {
      await userAdminApi.create({
        name: createForm.name.trim(),
        email: createForm.email.trim(),
        kuerzel: createForm.kuerzel.trim() || undefined,
        role: createForm.role,
        company: createForm.company.trim() || undefined,
        authMethod: createForm.authMethod,
        password: createForm.authMethod === 'password' ? createForm.password : undefined,
      });
      toast.success('Benutzer wurde angelegt.');
      setCreateOpen(false);
      setCreateForm(emptyCreate());
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Anlegen fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setSaving(true);
    try {
      await userAdminApi.update(editUser.id, {
        name: editForm.name,
        email: editForm.email,
        kuerzel: editForm.kuerzel,
        role: editForm.role as AdminRole,
        company: editForm.company,
        authMethod: editForm.authMethod as AdminAuthMethod,
        isDeactivated: editForm.isDeactivated,
      });
      toast.success('Benutzer aktualisiert.');
      setEditUser(null);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const handlePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordUser) return;
    if (newPassword.length < 8) {
      toast.error('Passwort mindestens 8 Zeichen.');
      return;
    }
    setSaving(true);
    try {
      await userAdminApi.setPassword(passwordUser.id, newPassword);
      toast.success('Passwort wurde gesetzt.');
      setPasswordUser(null);
      setNewPassword('');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Passwort konnte nicht gesetzt werden');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user: AdminUser) => {
    if (!window.confirm(`Benutzer „${user.name}“ (${user.email}) wirklich löschen?`)) return;
    try {
      await userAdminApi.remove(user.id);
      toast.success('Benutzer gelöscht.');
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Löschen fehlgeschlagen');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await userAdminApi.syncM365();
      toast.success(res.message || 'Synchronisation abgeschlossen');
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Synchronisation fehlgeschlagen');
    } finally {
      setSyncing(false);
    }
  };

  const saveEntra = async (e: FormEvent) => {
    e.preventDefault();
    if (!entra) return;
    setSaving(true);
    try {
      const domains = domainsText
        .split(/[,;\s]+/)
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
      const saved = await userAdminApi.saveEntraSettings({
        ...entra,
        allowedDomains: domains,
        clientSecret: entraSecret.trim() || undefined,
      });
      setEntra(saved);
      setEntraSecret('');
      toast.success('Microsoft 365 / Entra ID Einstellungen gespeichert.');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-[#1B6CA8]" />
            Benutzerverwaltung
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Manuelle Benutzer und Microsoft 365 / Entra ID — Rollen, Kürzel, Firma und Anmeldung.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void openEntra()}>
            <Settings2 className="w-3.5 h-3.5" />
            Microsoft 365 / Entra ID
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={syncing}
            onClick={() => void handleSync()}
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Aus Microsoft 365 synchronisieren
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5 font-bold"
            onClick={() => {
              setCreateForm(emptyCreate());
              setCreateOpen(true);
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Benutzer anlegen
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Gesamt', value: stats.total },
          { label: 'Aktiv', value: stats.active },
          { label: 'Lokal', value: stats.local },
          { label: 'Microsoft 365', value: stats.m365 },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{s.label}</p>
            <p className="text-2xl font-black text-slate-900">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen nach Name, E-Mail, Kürzel, Firma…"
            className="pl-10 h-11 rounded-xl"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
        >
          <option value="all">Alle Rollen</option>
          <option value="admins">Admins</option>
          <option value="agent">Mitarbeiter</option>
          <option value="customer">Kunden</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
        >
          <option value="all">Alle Typen</option>
          <option value="password">Manuell</option>
          <option value="microsoft365">Microsoft 365</option>
        </select>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-12 flex items-center justify-center gap-2 text-slate-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Benutzer werden geladen…
          </div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">Keine Benutzer gefunden.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="text-left px-4 py-3 font-bold">Benutzer</th>
                  <th className="text-left px-4 py-3 font-bold">Kürzel</th>
                  <th className="text-left px-4 py-3 font-bold">Rolle</th>
                  <th className="text-left px-4 py-3 font-bold">Firma</th>
                  <th className="text-left px-4 py-3 font-bold">Anmeldung</th>
                  <th className="text-left px-4 py-3 font-bold">Status</th>
                  <th className="text-left px-4 py-3 font-bold">Zuletzt aktiv</th>
                  <th className="text-right px-4 py-3 font-bold">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{u.name}</div>
                      <div className="text-xs text-slate-500 font-mono">{u.email}</div>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-700">{u.kuerzel || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge className={cn('text-[10px] font-bold border', roleBadgeClass(u.role))}>
                        {ROLE_LABELS[u.role] || u.role}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{u.company || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge
                        className={cn(
                          'text-[10px] font-bold border',
                          u.authMethod === 'microsoft365'
                            ? 'bg-blue-50 text-blue-800 border-blue-100'
                            : 'bg-slate-50 text-slate-700 border-slate-200',
                        )}
                      >
                        {u.authMethod === 'microsoft365' ? 'Microsoft 365' : 'Lokal'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={cn(
                          'text-[10px] font-bold border',
                          u.isDeactivated
                            ? 'bg-rose-50 text-rose-700 border-rose-100'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-100',
                        )}
                      >
                        {u.isDeactivated ? 'Deaktiviert' : 'Aktiv'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDate(u.lastActiveAt)}</td>
                    <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          setEditUser(u);
                          setEditForm({ ...u });
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        disabled={u.authMethod === 'microsoft365'}
                        title={
                          u.authMethod === 'microsoft365'
                            ? 'Passwort wird über Microsoft 365 verwaltet'
                            : 'Passwort zurücksetzen'
                        }
                        onClick={() => {
                          if (u.authMethod === 'microsoft365') {
                            toast.info('Passwort wird über Microsoft 365 verwaltet');
                            return;
                          }
                          setPasswordUser(u);
                          setNewPassword('');
                        }}
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs text-rose-600"
                        onClick={() => void handleDelete(u)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Neuen Benutzer anlegen</DialogTitle>
            <DialogDescription>
              Manuelles Konto mit Passwort oder Microsoft 365 / Entra ID (SSO).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition',
                  createForm.authMethod === 'password'
                    ? 'border-[#1B6CA8] bg-sky-50 ring-1 ring-[#1B6CA8]/30'
                    : 'border-slate-200',
                )}
                onClick={() => setCreateForm((f) => ({ ...f, authMethod: 'password' }))}
              >
                Manuell (Lokales Passwort)
              </button>
              <button
                type="button"
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition',
                  createForm.authMethod === 'microsoft365'
                    ? 'border-[#1B6CA8] bg-sky-50 ring-1 ring-[#1B6CA8]/30'
                    : 'border-slate-200',
                )}
                onClick={() => setCreateForm((f) => ({ ...f, authMethod: 'microsoft365', password: '' }))}
              >
                Microsoft 365 (SSO)
              </button>
            </div>

            <div className="space-y-1.5">
              <Label>Vollständiger Name</Label>
              <Input
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="Premton Xhafa"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>E-Mail-Adresse</Label>
              <Input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Kürzel</Label>
                <Input
                  value={createForm.kuerzel}
                  onChange={(e) => setCreateForm({ ...createForm, kuerzel: e.target.value })}
                  placeholder="PX"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Rolle</Label>
                <select
                  value={createForm.role}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, role: e.target.value as AdminRole })
                  }
                  className="w-full h-10 rounded-lg border border-input px-3 text-sm"
                >
                  <option value="agent">Mitarbeiter</option>
                  <option value="SYSTEM_ADMIN">Administrator</option>
                  <option value="customer">Kunde</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Firma / Organisation</Label>
              <Input
                value={createForm.company}
                onChange={(e) => setCreateForm({ ...createForm, company: e.target.value })}
                placeholder="Hubcom - Citadelle AG"
              />
            </div>
            {createForm.authMethod === 'password' ? (
              <div className="space-y-1.5">
                <Label>Initialpasswort</Label>
                <Input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  autoComplete="new-password"
                  required
                />
              </div>
            ) : (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Kein lokales Passwort — Anmeldung über „Mit Microsoft 365 anmelden“.
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={saving} className="font-bold">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Anlegen'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent className="sm:max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle>Benutzer bearbeiten</DialogTitle>
            <DialogDescription>{editUser?.email}</DialogDescription>
          </DialogHeader>
          {editUser ? (
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={editForm.name || ''}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>E-Mail</Label>
                <Input
                  type="email"
                  value={editForm.email || ''}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Kürzel</Label>
                  <Input
                    value={editForm.kuerzel || ''}
                    onChange={(e) => setEditForm({ ...editForm, kuerzel: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Rolle</Label>
                  <select
                    value={editForm.role || 'agent'}
                    onChange={(e) =>
                      setEditForm({ ...editForm, role: e.target.value as AdminRole })
                    }
                    className="w-full h-10 rounded-lg border border-input px-3 text-sm"
                  >
                    <option value="agent">Mitarbeiter</option>
                    <option value="SYSTEM_ADMIN">Administrator</option>
                    <option value="customer">Kunde</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Firma</Label>
                <Input
                  value={editForm.company || ''}
                  onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Authentifizierungsart</Label>
                <select
                  value={editForm.authMethod || 'password'}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      authMethod: e.target.value as AdminAuthMethod,
                    })
                  }
                  className="w-full h-10 rounded-lg border border-input px-3 text-sm"
                >
                  <option value="password">Manuell (Lokal)</option>
                  <option value="microsoft365">Microsoft 365</option>
                </select>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                <div>
                  <p className="text-xs font-bold text-slate-800">Konto deaktiviert</p>
                  <p className="text-[10px] text-slate-400">Deaktivierte Benutzer können sich nicht anmelden.</p>
                </div>
                <Switch
                  checked={editForm.isDeactivated === true}
                  onCheckedChange={(v) => setEditForm({ ...editForm, isDeactivated: v })}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditUser(null)}>
                  Abbrechen
                </Button>
                <Button type="submit" disabled={saving} className="font-bold">
                  Speichern
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Password */}
      <Dialog open={!!passwordUser} onOpenChange={(o) => !o && setPasswordUser(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Passwort zurücksetzen</DialogTitle>
            <DialogDescription>{passwordUser?.name}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Neues Passwort</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPasswordUser(null)}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={saving} className="font-bold">
                Passwort setzen
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Entra settings */}
      <Dialog open={entraOpen} onOpenChange={setEntraOpen}>
        <DialogContent className="sm:max-w-xl rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Microsoft 365 / Entra ID Einstellungen</DialogTitle>
            <DialogDescription>
              OIDC-Anmeldung, JIT-Provisioning und Verzeichnis-Synchronisation.
            </DialogDescription>
          </DialogHeader>
          {entra ? (
            <form onSubmit={saveEntra} className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                <div>
                  <p className="text-xs font-bold">Microsoft 365 Anmeldung aktiv</p>
                  <p className="text-[10px] text-slate-400">Zeigt den Login-Button, sobald konfiguriert.</p>
                </div>
                <Switch
                  checked={entra.enabled}
                  onCheckedChange={(v) => setEntra({ ...entra, enabled: v })}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Tenant ID</Label>
                  <Input
                    value={entra.tenantId}
                    onChange={(e) => setEntra({ ...entra, tenantId: e.target.value })}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Client ID</Label>
                  <Input
                    value={entra.clientId}
                    onChange={(e) => setEntra({ ...entra, clientId: e.target.value })}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Client Secret {entra.hasClientSecret ? '(gespeichert)' : ''}</Label>
                  <Input
                    type="password"
                    value={entraSecret}
                    onChange={(e) => setEntraSecret(e.target.value)}
                    placeholder={entra.hasClientSecret ? '••••••••' : 'Secret eingeben'}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Redirect URI</Label>
                  <Input
                    value={entra.redirectUri}
                    onChange={(e) => setEntra({ ...entra, redirectUri: e.target.value })}
                    placeholder="https://ihre-domain/api/auth/microsoft/callback"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Standard-Rolle (neue M365-Benutzer)</Label>
                  <select
                    value={entra.defaultRole}
                    onChange={(e) =>
                      setEntra({ ...entra, defaultRole: e.target.value as AdminRole })
                    }
                    className="w-full h-10 rounded-lg border border-input px-3 text-sm"
                  >
                    <option value="agent">Support-Mitarbeiter</option>
                    <option value="customer">Kunde</option>
                    <option value="SYSTEM_ADMIN">Administrator</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Erlaubte E-Mail-Domains</Label>
                  <Input
                    value={domainsText}
                    onChange={(e) => setDomainsText(e.target.value)}
                    placeholder="hubcom.de, citadelle.de"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                <div>
                  <p className="text-xs font-bold">JIT-Auto-Anlage</p>
                  <p className="text-[10px] text-slate-400">
                    Unbekannte M365-Benutzer bei Login automatisch anlegen.
                  </p>
                </div>
                <Switch
                  checked={entra.jitProvisioning}
                  onCheckedChange={(v) => setEntra({ ...entra, jitProvisioning: v })}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEntraOpen(false)}>
                  Schließen
                </Button>
                <Button type="submit" disabled={saving} className="font-bold">
                  Speichern
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
