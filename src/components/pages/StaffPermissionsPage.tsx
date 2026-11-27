/**
 * Admin-Hub → Mitarbeiter & Berechtigungen
 * 100% German UI for Hubcom matrix roles + per-company ORG_ADMIN / ORG_AGENT.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Search,
  Shield,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { cn } from '../../lib/utils';
import {
  staffUsersApi,
  type StaffOrgAssignment,
  type StaffOrgMeta,
  type StaffUser,
} from '../../services/staffUsersApi';
import {
  COMPANY_ACCESS_OPTIONS,
  HUBCOM_ROLE_OPTIONS,
  hubcomRoleLabelDe,
  hubcomRolePillClass,
  orgAccessLabelDe,
  summarizeStaffScopePills,
  type CompanyAccessChoice,
} from '../../lib/staff-access-ui';
import type { HubcomMatrixRole } from '../../lib/staff-org-access-shared';
import { useStaffSession } from '../../hooks/useStaffSession';
import { Navigate } from 'react-router-dom';

type DraftAccess = Record<string, CompanyAccessChoice>;

function assignmentsFromDraft(draft: DraftAccess | null | undefined): StaffOrgAssignment[] {
  return Object.entries(draft ?? {})
    .filter(([, v]) => v === 'ORG_ADMIN' || v === 'ORG_AGENT')
    .map(([organization_id, access_role]) => ({
      organization_id,
      access_role: access_role as 'ORG_ADMIN' | 'ORG_AGENT',
    }));
}

function draftFromUser(user: StaffUser | null, orgs: StaffOrgMeta[]): DraftAccess {
  const draft: DraftAccess = {};
  for (const o of orgs) draft[o.id] = 'none';
  for (const a of user?.organization_access || []) {
    draft[a.organization_id] = a.access_role as CompanyAccessChoice;
  }
  return draft;
}

export default function StaffPermissionsPage() {
  const { loading: sessionLoading, canManageHubcomCore } = useStaffSession();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [orgs, setOrgs] = useState<StaffOrgMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const [editUser, setEditUser] = useState<StaffUser | null>(null);
  const [editRole, setEditRole] = useState<HubcomMatrixRole>('HUBCOM_USER');
  const [editDraft, setEditDraft] = useState<DraftAccess>({});
  const [editOpen, setEditOpen] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<HubcomMatrixRole>('HUBCOM_USER');
  const [inviteDraft, setInviteDraft] = useState<DraftAccess>({});

  const orgNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orgs) m.set(o.id, o.name);
    return m;
  }, [orgs]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, meta] = await Promise.all([staffUsersApi.list(), staffUsersApi.meta()]);
      setUsers(list.users);
      setOrgs(meta.organizations);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Mitarbeiter konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canManageHubcomCore) return;
    void load();
  }, [canManageHubcomCore, load]);

  const pending = useMemo(
    () => users.filter((u) => u.approval_status === 'pending_approval' && !u.isDeactivated),
    [users],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const activePool = users.filter((u) => u.approval_status !== 'pending_approval');
    if (!q) return activePool;
    return activePool.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        String(u.role).toLowerCase().includes(q),
    );
  }, [users, search]);

  const openEdit = (user: StaffUser) => {
    setEditUser(user);
    setEditRole((user.role as HubcomMatrixRole) || 'HUBCOM_USER');
    setEditDraft(draftFromUser(user, orgs));
    setEditOpen(true);
  };

  const openInvite = () => {
    setInviteName('');
    setInviteEmail('');
    setInviteRole('HUBCOM_USER');
    setInviteDraft(draftFromUser(null, orgs));
    setInviteOpen(true);
  };

  const saveEdit = async (opts?: { approve?: boolean; reject?: boolean }) => {
    if (!editUser) return;
    setSaving(true);
    try {
      const payload: Parameters<typeof staffUsersApi.update>[1] = {
        role: editRole,
        organization_access:
          editRole === 'SUPER_ADMIN' ? [] : assignmentsFromDraft(editDraft),
      };
      if (opts?.approve) payload.approval_status = 'active';
      if (opts?.reject) payload.approval_status = 'rejected';
      await staffUsersApi.update(editUser.id, payload);
      toast.success(
        opts?.approve
          ? 'Kollege freigegeben.'
          : opts?.reject
            ? 'Zugriffsanfrage abgelehnt.'
            : 'Berechtigungen gespeichert.',
      );
      setEditOpen(false);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const saveInvite = async () => {
    if (!inviteName.trim() || !inviteEmail.trim()) {
      toast.error('Name und E-Mail sind erforderlich.');
      return;
    }
    setSaving(true);
    try {
      await staffUsersApi.invite({
        name: inviteName.trim(),
        email: inviteEmail.trim(),
        role: inviteRole,
        approval_status: 'active',
        authMethod: 'microsoft365',
        organization_access:
          inviteRole === 'SUPER_ADMIN' ? [] : assignmentsFromDraft(inviteDraft),
      });
      toast.success('Kollege eingeladen.');
      setInviteOpen(false);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Einladung fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const setAllNone = (setter: (d: DraftAccess) => void, current: DraftAccess) => {
    const next: DraftAccess = { ...(current ?? {}) };
    for (const id of Object.keys(next ?? {})) next[id] = 'none';
    setter(next);
  };

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 gap-2 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Sitzung wird geladen…
      </div>
    );
  }

  if (!canManageHubcomCore) {
    return <Navigate to="/admin?tab=uebersicht" replace />;
  }

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-black tracking-tight text-slate-900 flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Mitarbeiter & Berechtigungen
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Hubcom-Rollen und Kundenunternehmen-Zugriff für interne Kollegen verwalten.
          </p>
        </div>
        <Button type="button" className="h-9 rounded-xl text-xs font-bold gap-1.5" onClick={openInvite}>
          <UserPlus className="w-3.5 h-3.5" />
          Kollegen einladen
        </Button>
      </div>

      {pending.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-amber-700" />
            <h2 className="text-sm font-black text-amber-900">
              Ausstehende Hubcom-M365-Freigaben ({pending.length})
            </h2>
          </div>
          <ul className="space-y-2">
            {pending.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white border border-amber-100 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{u.name || u.email}</p>
                  <p className="text-[11px] text-slate-500 font-medium truncate">{u.email}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-xl text-[11px] font-bold"
                    onClick={() => openEdit(u)}
                  >
                    Berechtigungen zuweisen
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-xl text-[11px] font-bold gap-1 bg-emerald-600 hover:bg-emerald-700"
                    disabled={saving}
                    onClick={() => {
                      setEditUser(u);
                      setEditRole((u.role as HubcomMatrixRole) || 'HUBCOM_USER');
                      setEditDraft(draftFromUser(u, orgs));
                      void (async () => {
                        setSaving(true);
                        try {
                          await staffUsersApi.update(u.id, {
                            approval_status: 'active',
                            role: (u.role as HubcomMatrixRole) || 'HUBCOM_USER',
                            organization_access: u.organization_access,
                          });
                          toast.success('Kollege freigegeben.');
                          await load();
                        } catch (err: any) {
                          toast.error(err?.response?.data?.error || 'Freigabe fehlgeschlagen.');
                        } finally {
                          setSaving(false);
                        }
                      })();
                    }}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Freigeben
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-xl text-[11px] font-bold text-rose-600 border-rose-200"
                    disabled={saving}
                    onClick={() => {
                      void (async () => {
                        setSaving(true);
                        try {
                          await staffUsersApi.update(u.id, { approval_status: 'rejected' });
                          toast.success('Zugriffsanfrage abgelehnt.');
                          await load();
                        } catch (err: any) {
                          toast.error(err?.response?.data?.error || 'Ablehnung fehlgeschlagen.');
                        } finally {
                          setSaving(false);
                        }
                      })();
                    }}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Ablehnen
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 justify-between">
          <h2 className="text-sm font-black text-slate-900">Kollegen</h2>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Suchen…"
              className="h-8 pl-8 rounded-xl text-xs"
            />
          </div>
        </div>

        {loading ? (
          <div className="py-16 flex items-center justify-center text-slate-400 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Wird geladen…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-14 text-center text-sm text-slate-500 font-semibold">
            Keine Kollegen gefunden.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400 font-extrabold">
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Berechtigungen</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((u) => {
                  const pills = summarizeStaffScopePills({
                    role: String(u.role),
                    organization_access: u.organization_access || [],
                    orgNameById,
                  });
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 align-top">
                        <p className="font-bold text-slate-900">{u.name || '—'}</p>
                        <p className="text-[11px] text-slate-500 font-medium">{u.email}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap gap-1.5">
                          {pills.map((p) => (
                            <Badge
                              key={p.key}
                              className={cn(
                                'text-[10px] font-bold border px-2 py-0.5 rounded-full',
                                p.className,
                              )}
                            >
                              {p.label}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Badge
                          className={cn(
                            'text-[10px] font-bold border-none',
                            u.isDeactivated
                              ? 'bg-slate-100 text-slate-500'
                              : 'bg-emerald-50 text-emerald-700',
                          )}
                        >
                          {u.isDeactivated ? 'Deaktiviert' : 'Aktiv'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-xl text-[11px] font-bold"
                          onClick={() => openEdit(u)}
                        >
                          Berechtigungen bearbeiten
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PermissionMatrixDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title={
          editUser?.approval_status === 'pending_approval'
            ? `Freigabe — ${editUser?.name || editUser?.email}`
            : `Berechtigungen — ${editUser?.name || editUser?.email}`
        }
        role={editRole}
        onRoleChange={setEditRole}
        draft={editDraft}
        onDraftChange={setEditDraft}
        orgs={orgs}
        saving={saving}
        onSave={() => void saveEdit()}
        onApprove={
          editUser?.approval_status === 'pending_approval'
            ? () => void saveEdit({ approve: true })
            : undefined
        }
        onReject={
          editUser?.approval_status === 'pending_approval'
            ? () => void saveEdit({ reject: true })
            : undefined
        }
        onClearAll={() => setAllNone(setEditDraft, editDraft)}
      />

      <PermissionMatrixDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title="Kollegen einladen"
        role={inviteRole}
        onRoleChange={setInviteRole}
        draft={inviteDraft}
        onDraftChange={setInviteDraft}
        orgs={orgs}
        saving={saving}
        onSave={() => void saveInvite()}
        onClearAll={() => setAllNone(setInviteDraft, inviteDraft)}
        inviteFields={{
          name: inviteName,
          email: inviteEmail,
          onName: setInviteName,
          onEmail: setInviteEmail,
        }}
      />
    </div>
  );
}

function PermissionMatrixDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  role: HubcomMatrixRole;
  onRoleChange: (r: HubcomMatrixRole) => void;
  draft: DraftAccess;
  onDraftChange: (d: DraftAccess) => void;
  orgs: StaffOrgMeta[];
  saving: boolean;
  onSave: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onClearAll: () => void;
  inviteFields?: {
    name: string;
    email: string;
    onName: (v: string) => void;
    onEmail: (v: string) => void;
  };
}) {
  const isSuper = props.role === 'SUPER_ADMIN';
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-black">{props.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {props.inviteFields ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Name</Label>
                <Input
                  value={props.inviteFields.name}
                  onChange={(e) => props.inviteFields!.onName(e.target.value)}
                  className="h-9 rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">E-Mail</Label>
                <Input
                  type="email"
                  value={props.inviteFields.email}
                  onChange={(e) => props.inviteFields!.onEmail(e.target.value)}
                  className="h-9 rounded-xl"
                />
              </div>
            </div>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              1. Hubcom-Systemzugriff (Intern)
            </h3>
            <div className="space-y-1.5">
              {HUBCOM_ROLE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors',
                    props.role === opt.value
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-slate-200 hover:bg-slate-50',
                  )}
                >
                  <input
                    type="radio"
                    className="mt-1"
                    checked={props.role === opt.value}
                    onChange={() => props.onRoleChange(opt.value)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-slate-900">{opt.label}</span>
                    <span className="block text-[11px] text-slate-500 font-medium leading-snug">
                      {opt.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                2. Kundenunternehmen-Berechtigungen
              </h3>
              {!isSuper ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] font-bold"
                  onClick={props.onClearAll}
                >
                  Alle auf Kein Zugriff
                </Button>
              ) : null}
            </div>

            {isSuper ? (
              <p className="text-xs text-slate-500 font-medium rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-2">
                Als <strong>{hubcomRoleLabelDe('SUPER_ADMIN')}</strong> hat dieser Kollege
                automatisch Zugriff auf alle Kundenunternehmen.
              </p>
            ) : props.orgs.length === 0 ? (
              <p className="text-xs text-slate-500 font-medium">Noch keine Kundenunternehmen vorhanden.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                {props.orgs.map((org) => {
                  const value = props.draft[org.id] || 'none';
                  return (
                    <li
                      key={org.id}
                      className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2.5 bg-white"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-900 truncate">{org.name}</p>
                        <p className="text-[10px] text-slate-400 font-medium">
                          {COMPANY_ACCESS_OPTIONS.find((o) => o.value === value)?.description}
                        </p>
                      </div>
                      <select
                        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700"
                        value={value}
                        onChange={(e) =>
                          props.onDraftChange({
                            ...props.draft,
                            [org.id]: e.target.value as CompanyAccessChoice,
                          })
                        }
                      >
                        {COMPANY_ACCESS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {props.onReject ? (
            <Button
              type="button"
              variant="outline"
              className="rounded-xl text-xs font-bold text-rose-600"
              disabled={props.saving}
              onClick={props.onReject}
            >
              Ablehnen
            </Button>
          ) : null}
          {props.onApprove ? (
            <Button
              type="button"
              className="rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700"
              disabled={props.saving}
              onClick={props.onApprove}
            >
              {props.saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Freigeben
            </Button>
          ) : (
            <Button
              type="button"
              className="rounded-xl text-xs font-bold"
              disabled={props.saving}
              onClick={props.onSave}
            >
              {props.saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Speichern
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
