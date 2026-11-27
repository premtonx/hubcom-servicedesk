import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  KeyRound,
  Loader2,
  Pencil,
  Search,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { DeletePortalUserDialog } from '../../ui/DeletePortalUserDialog';
import { cn } from '../../../lib/utils';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';
import axios from 'axios';
import {
  clientPortalApi,
  type PortalMember,
  type PortalTeamRole,
  type PortalTeamSummary,
} from '../../../services/clientPortalApi';
import {
  resolvePortalSettingsPaths,
  type PortalSettingsMode,
} from '../../../lib/client-portal/portal-settings-api-base';

const ROLE_META: Record<
  PortalTeamRole,
  { badge: string; label: string; description: string; tone: string }
> = {
  CLIENT_ADMIN: {
    badge: 'Admin',
    label: 'Admin',
    description: 'Vollzugriff inkl. Portal-Einstellungen, Benutzer & SSO-Freigaben',
    tone: 'bg-indigo-50 text-indigo-700',
  },
  CLIENT_SUPPORTER: {
    badge: 'Bearbeiter',
    label: 'Bearbeiter / Supporter',
    description: 'Tickets & Rücklieferungen ansehen und bearbeiten',
    tone: 'bg-violet-50 text-violet-700',
  },
  CLIENT_USER: {
    badge: 'Benutzer',
    label: 'Benutzer',
    description: 'Eigene Tickets einsehen & erstellen',
    tone: 'bg-slate-100 text-slate-700',
  },
};

const EMPTY_SUMMARY: PortalTeamSummary = {
  totalActive: 0,
  clientAdmins: 0,
  clientSupporters: 0,
  clientUsers: 0,
  total: 0,
};

export type ClientMembersPageProps = {
  mode?: PortalSettingsMode;
  organizationId?: string | null;
  embedded?: boolean;
  /** When true, open the invite dialog on mount (admin quick action). */
  focusInvite?: boolean;
  className?: string;
};

export default function ClientMembersPage({
  mode = 'portal',
  organizationId = null,
  embedded = false,
  focusInvite = false,
  className,
}: ClientMembersPageProps = {}) {
  const { session } = useClientPortalSession();
  const selfId = mode === 'admin' ? '' : String(session?.id || '');
  const paths = (() => {
    try {
      return resolvePortalSettingsPaths(mode, organizationId);
    } catch {
      return null;
    }
  })();
  const [members, setMembers] = useState<PortalMember[]>([]);
  const [summary, setSummary] = useState<PortalTeamSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selected, setSelected] = useState<PortalMember | null>(null);
  const [deleteMember, setDeleteMember] = useState<PortalMember | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState<PortalTeamRole>('CLIENT_USER');
  const [inviteResult, setInviteResult] = useState<{
    setupLink?: string | null;
    emailSent?: boolean;
    emailReason?: string | null;
    invitationStatus?: string;
  } | null>(null);
  const [pendingDeactivate, setPendingDeactivate] = useState<PortalMember | null>(null);

  const load = useCallback(async () => {
    if (!paths) return;
    setLoading(true);
    try {
      if (mode === 'portal') {
        const data = await clientPortalApi.listTeam();
        setMembers(data.members);
        setSummary(data.summary);
      } else {
        const res = await axios.get(paths.membersBase, { withCredentials: true });
        const members = (res.data?.members || []).map((m: any) => ({
          ...m,
          isDeactivated: m.isActive === false,
          isActive: m.isActive !== false && m.isDeactivated !== true,
        }));
        setMembers(members);
        setSummary(
          res.data?.summary || {
            totalActive: members.filter((m: any) => m.isActive !== false).length,
            clientAdmins: members.filter((m: any) => m.role === 'CLIENT_ADMIN').length,
            clientSupporters: members.filter((m: any) => m.role === 'CLIENT_SUPPORTER').length,
            clientUsers: members.filter((m: any) => m.role === 'CLIENT_USER').length,
            total: members.length,
          },
        );
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Team konnte nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, [mode, paths]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!focusInvite) return;
    setFormName('');
    setFormEmail('');
    setFormRole('CLIENT_ADMIN');
    setInviteResult(null);
    setAddOpen(true);
  }, [focusInvite]);

  const pendingSso = useMemo(
    () => members.filter((m) => m.approvalStatus === 'pending_approval'),
    [members],
  );

  const [pendingRoles, setPendingRoles] = useState<Record<string, PortalTeamRole>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const activePool = members.filter((m) => m.approvalStatus !== 'pending_approval');
    if (!q) return activePool;
    return activePool.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q),
    );
  }, [members, search]);

  const approvePending = async (member: PortalMember) => {
    const role = pendingRoles[member.id] || (member.role as PortalTeamRole) || 'CLIENT_USER';
    setApprovingId(member.id);
    try {
      if (mode === 'portal') {
        await clientPortalApi.approveTeamMember(member.id, role);
      } else if (paths) {
        await axios.post(paths.memberApprove(member.id), { role }, { withCredentials: true });
      }
      toast.success(`${member.name || member.email} freigegeben als ${ROLE_META[role].label}.`);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Freigabe fehlgeschlagen');
    } finally {
      setApprovingId(null);
    }
  };

  const rejectPending = async (member: PortalMember) => {
    if (!confirm(`Zugriffsanfrage von ${member.email} ablehnen?`)) return;
    setApprovingId(member.id);
    try {
      if (mode === 'portal') {
        await clientPortalApi.rejectTeamMember(member.id);
      } else if (paths) {
        await axios.post(paths.memberReject(member.id), {}, { withCredentials: true });
      }
      toast.success('Zugriffsanfrage abgelehnt.');
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Ablehnung fehlgeschlagen');
    } finally {
      setApprovingId(null);
    }
  };

  const openAdd = () => {
    setFormName('');
    setFormEmail('');
    setFormRole('CLIENT_USER');
    setInviteResult(null);
    setAddOpen(true);
  };

  const openEdit = (member: PortalMember) => {
    setSelected(member);
    setFormName(member.name || '');
    setFormRole((member.role as PortalTeamRole) || 'CLIENT_USER');
    setEditOpen(true);
  };

  const submitAdd = async () => {
    if (!formName.trim() || !formEmail.trim()) {
      toast.error('Name und E-Mail sind erforderlich.');
      return;
    }
    setSaving(true);
    try {
      const result =
        mode === 'portal'
          ? await clientPortalApi.createTeamMember({
              name: formName.trim(),
              email: formEmail.trim(),
              role: formRole,
            })
          : await (async () => {
              const res = await axios.post(
                paths!.membersBase,
                { name: formName.trim(), email: formEmail.trim(), role: formRole },
                { withCredentials: true },
              );
              return {
                member: res.data?.member,
                setupLink: res.data?.setupLink ?? null,
                emailSent: res.data?.emailSent,
                emailReason: res.data?.emailReason ?? null,
                invitationStatus: res.data?.invitationStatus,
              };
            })();
      setInviteResult({
        setupLink: result.setupLink,
        emailSent: result.emailSent,
        emailReason: result.emailReason,
        invitationStatus: result.invitationStatus,
      });
      if (result.emailSent) {
        toast.success('Einladung gesendet.');
      } else {
        toast.error(
          `Mitarbeiter angelegt, aber E-Mail fehlgeschlagen${
            result.emailReason ? `: ${result.emailReason}` : '.'
          }`,
        );
      }
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Anlegen fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      if (mode === 'portal') {
        await clientPortalApi.updateTeamMember(selected.id, {
          name: formName.trim(),
          role: formRole,
        });
      } else if (paths) {
        await axios.patch(
          paths.memberById(selected.id),
          { name: formName.trim(), role: formRole },
          { withCredentials: true },
        );
      }
      toast.success('Mitarbeiter aktualisiert.');
      setEditOpen(false);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Aktualisieren fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const confirmToggleActive = (member: PortalMember) => {
    setPendingDeactivate(member);
    setConfirmOpen(true);
  };

  const applyToggleActive = async () => {
    if (!pendingDeactivate) return;
    const nextActive = pendingDeactivate.isActive === false || pendingDeactivate.isDeactivated === true;
    setSaving(true);
    try {
      if (mode === 'portal') {
        await clientPortalApi.updateTeamMember(pendingDeactivate.id, { isActive: nextActive });
      } else if (paths) {
        await axios.patch(
          paths.memberById(pendingDeactivate.id),
          { isActive: nextActive },
          { withCredentials: true },
        );
      }
      toast.success(nextActive ? 'Mitarbeiter aktiviert.' : 'Mitarbeiter deaktiviert.');
      setConfirmOpen(false);
      setPendingDeactivate(null);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Statusänderung fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async (member: PortalMember) => {
    if (!confirm(`Passwort-Reset für ${member.email} auslösen?`)) return;
    setSaving(true);
    try {
      const result =
        mode === 'portal'
          ? await clientPortalApi.resetTeamMemberPassword(member.id)
          : await (async () => {
              const res = await axios.post(
                paths!.memberResetPassword(member.id),
                {},
                { withCredentials: true },
              );
              return {
                setupLink: res.data?.setupLink ?? null,
                emailSent: res.data?.emailSent,
                emailReason: res.data?.emailReason ?? null,
                invitationStatus: res.data?.invitationStatus,
              };
            })();
      if (result.emailSent) {
        toast.success('Reset-/Einladungs-E-Mail gesendet.');
      } else {
        toast.error(
          `E-Mail fehlgeschlagen${result.emailReason ? `: ${result.emailReason}` : '.'}`,
        );
        if (result.setupLink) {
          toast.message('Setup-Link (nur bei Versandfehler)', {
            description: result.setupLink,
          });
        }
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Reset fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  if (mode === 'admin' && !paths) {
    return (
      <div className="p-10 text-center text-sm text-slate-500">
        Organisation nicht ausgewählt.
      </div>
    );
  }

  return (
    <div className={embedded ? `space-y-6 ${className || ''}` : `max-w-5xl mx-auto p-6 lg:p-10 space-y-6 ${className || ''}`}>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          {!embedded ? (
            <>
              <h1 className="text-2xl font-black tracking-tight">Mitarbeiter & Rollen</h1>
              <p className="text-sm text-slate-500 mt-1">
                Verwalten Sie Kollegen Ihrer Organisation — nur Client-Rollen, keine Hubcom-Rechte.
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500 font-medium">
              Benutzerliste, Rollen und offene M365-SSO-Zugriffsanfragen für diese Organisation.
            </p>
          )}
        </div>
        <Button type="button" className="gap-2" onClick={openAdd}>
          <UserPlus className="w-4 h-4" />
          Mitarbeiter hinzufügen
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          icon={<Users className="w-4 h-4 text-slate-500" />}
          label="Aktive Nutzer"
          value={summary.totalActive}
        />
        <SummaryCard
          icon={<UserCheck className="w-4 h-4 text-violet-600" />}
          label="Bearbeiter / Supporter"
          value={summary.clientSupporters}
        />
        <SummaryCard
          icon={<Shield className="w-4 h-4 text-indigo-600" />}
          label="Admins"
          value={summary.clientAdmins}
        />
      </div>

      {pendingSso.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-amber-900">
              Offene SSO-Zugriffsanfragen
            </h2>
            <p className="text-sm text-amber-800/80 mt-1">
              Neue Microsoft-365-Benutzer warten auf Freigabe und Rollenzuweisung.
            </p>
          </div>
          <ul className="space-y-3">
            {pendingSso.map((m) => {
              const chosen =
                pendingRoles[m.id] || (m.role as PortalTeamRole) || 'CLIENT_USER';
              return (
                <li
                  key={m.id}
                  className="rounded-xl border border-amber-200/80 bg-white p-4 flex flex-col lg:flex-row lg:items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{m.name || '—'}</p>
                    <p className="text-sm text-slate-600 truncate">{m.email}</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Anfrage: {formatDate(m.approvalRequestedAt || m.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 shrink-0">
                    <select
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium max-w-xs"
                      value={chosen}
                      onChange={(e) =>
                        setPendingRoles((prev) => ({
                          ...prev,
                          [m.id]: e.target.value as PortalTeamRole,
                        }))
                      }
                      aria-label="Rolle bei Freigabe"
                    >
                      {(Object.keys(ROLE_META) as PortalTeamRole[]).map((role) => (
                        <option key={role} value={role}>
                          {ROLE_META[role].label} — {ROLE_META[role].description}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={approvingId === m.id}
                      onClick={() => void approvePending(m)}
                    >
                      {approvingId === m.id ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-1" />
                      ) : null}
                      Freigeben
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-rose-200 text-rose-700 hover:bg-rose-50"
                      disabled={approvingId === m.id}
                      onClick={() => void rejectPending(m)}
                    >
                      Ablehnen
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="relative max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Suche nach Name, E-Mail oder Rolle…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400 font-bold text-left">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">E-Mail</th>
                <th className="px-4 py-3">Rolle</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Letzter Login</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                    Laden…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                    Keine Mitarbeiter gefunden.
                  </td>
                </tr>
              ) : (
                filtered.map((m) => {
                  const active = m.isActive !== false && m.isDeactivated !== true;
                  const meta = ROLE_META[(m.role as PortalTeamRole) || 'CLIENT_USER'] || ROLE_META.CLIENT_USER;
                  return (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-semibold text-slate-900">{m.name || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{m.email}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full',
                            meta.tone,
                          )}
                        >
                          {meta.badge}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full',
                            active
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-rose-50 text-rose-700',
                          )}
                        >
                          {active ? 'Aktiv' : 'Deaktiviert'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {formatDate(m.lastLoginAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 px-2"
                            onClick={() => openEdit(m)}
                            title="Bearbeiten"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 px-2"
                            onClick={() => void resetPassword(m)}
                            title="Passwort zurücksetzen"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 text-xs font-bold"
                            onClick={() => confirmToggleActive(m)}
                          >
                            {active ? 'Deaktivieren' : 'Aktivieren'}
                          </Button>
                          {selfId && m.id === selfId ? null : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1 px-2 text-xs font-bold text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                              disabled={deleting}
                              onClick={() => setDeleteMember(m)}
                              title="Entfernen"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Entfernen
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DeletePortalUserDialog
        open={Boolean(deleteMember)}
        name={deleteMember?.name || ''}
        email={deleteMember?.email || ''}
        busy={deleting}
        onCancel={() => setDeleteMember(null)}
        onConfirm={async () => {
          if (!deleteMember) return;
          setDeleting(true);
          try {
            if (mode === 'portal') {
        await clientPortalApi.deleteTeamMember(deleteMember.id);
      } else if (paths) {
        await axios.delete(paths.memberById(deleteMember.id), { withCredentials: true });
      }
            toast.success(
              `Portal-Benutzer entfernt: ${deleteMember.name || deleteMember.email}`,
            );
            setDeleteMember(null);
            await load();
          } catch (err: any) {
            toast.error(err?.response?.data?.error || 'Entfernen fehlgeschlagen');
          } finally {
            setDeleting(false);
          }
        }}
      />

      {/* Add modal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Mitarbeiter hinzufügen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>E-Mail</Label>
              <Input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Rolle</Label>
              <div className="space-y-2">
                {(Object.keys(ROLE_META) as PortalTeamRole[]).map((role) => (
                  <label
                    key={role}
                    className={cn(
                      'flex gap-3 rounded-xl border p-3 cursor-pointer',
                      formRole === role
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300',
                    )}
                  >
                    <input
                      type="radio"
                      className="mt-1"
                      checked={formRole === role}
                      onChange={() => setFormRole(role)}
                    />
                    <span>
                      <span className="text-sm font-bold block">{ROLE_META[role].label}</span>
                      <span className="text-xs text-slate-500 leading-relaxed">
                        {ROLE_META[role].description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {inviteResult ? (
              <div
                className={`rounded-xl border px-3 py-2 text-xs space-y-1 ${
                  inviteResult.emailSent
                    ? 'border-emerald-100 bg-emerald-50/70 text-emerald-900'
                    : 'border-amber-100 bg-amber-50/70 text-amber-950'
                }`}
              >
                {inviteResult.emailSent ? (
                  <p>Einladungs-E-Mail wurde gesendet. Es wird kein Passwort angezeigt.</p>
                ) : (
                  <p>
                    E-Mail-Versand fehlgeschlagen — Benutzer ist angelegt, aber nicht benachrichtigt.
                    {inviteResult.emailReason ? ` (${inviteResult.emailReason})` : ''}
                  </p>
                )}
                {!inviteResult.emailSent && inviteResult.setupLink ? (
                  <p className="break-all">
                    Autorisierter Setup-Link:{' '}
                    <code className="font-mono">{inviteResult.setupLink}</code>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Schließen
            </Button>
            {!inviteResult ? (
              <Button type="button" disabled={saving} onClick={() => void submitAdd()}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Einladen'}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit modal */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Mitarbeiter bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Rolle</Label>
              <select
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={formRole}
                onChange={(e) => setFormRole(e.target.value as PortalTeamRole)}
              >
                {(Object.keys(ROLE_META) as PortalTeamRole[]).map((role) => (
                  <option key={role} value={role}>
                    {ROLE_META[role].label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">{ROLE_META[formRole].description}</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Abbrechen
            </Button>
            <Button type="button" disabled={saving} onClick={() => void submitEdit()}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activate / deactivate confirm */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingDeactivate &&
              (pendingDeactivate.isActive === false || pendingDeactivate.isDeactivated === true)
                ? 'Mitarbeiter aktivieren?'
                : 'Mitarbeiter deaktivieren?'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-2">
            {pendingDeactivate
              ? pendingDeactivate.isActive === false || pendingDeactivate.isDeactivated === true
                ? `${pendingDeactivate.name || pendingDeactivate.email} wird wieder Zugriff auf das Kunden-Portal erhalten.`
                : `${pendingDeactivate.name || pendingDeactivate.email} verliert den Zugang zum Kunden-Portal. Der letzte aktive Client Admin kann nicht deaktiviert werden.`
              : ''}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Abbrechen
            </Button>
            <Button type="button" disabled={saving} onClick={() => void applyToggleActive()}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Bestätigen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 text-slate-400 mb-2">
        {icon}
        <span className="text-[10px] font-extrabold uppercase tracking-widest">{label}</span>
      </div>
      <div className="text-3xl font-black text-slate-900 tabular-nums">{value}</div>
    </div>
  );
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}
