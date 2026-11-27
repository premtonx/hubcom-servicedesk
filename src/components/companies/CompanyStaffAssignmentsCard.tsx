/**
 * Compact card: Zuständige Hubcom-Mitarbeiter for a client organization.
 */

import { useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { staffUsersApi, type StaffOrgAccessRow } from '../../services/staffUsersApi';
import {
  hubcomRoleLabelDe,
  orgAccessLabelDe,
  orgAccessPillClass,
} from '../../lib/staff-access-ui';

export function CompanyStaffAssignmentsCard({
  organizationId,
}: {
  organizationId: string | null | undefined;
}) {
  const [rows, setRows] = useState<StaffOrgAccessRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const oid = String(organizationId || '').trim();
    if (!oid) {
      setRows([]);
      return;
    }
    let active = true;
    setLoading(true);
    void staffUsersApi
      .listOrgStaffAccess(oid)
      .then((data) => {
        if (active) setRows(data);
      })
      .catch(() => {
        if (active) setRows([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

  if (!organizationId) return null;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-black text-slate-900">Zuständige Hubcom-Mitarbeiter</h3>
      </div>
      {loading ? (
        <p className="text-xs text-slate-400 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Wird geladen…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500 font-medium">
          Noch keine Hubcom-Kollegen dieser Firma zugewiesen.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={`${r.user_id}-${r.access_role}`}
              className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 truncate">
                  {r.name || r.email || r.user_id}
                </p>
                <p className="text-[10px] text-slate-500 font-medium truncate">
                  {hubcomRoleLabelDe(r.role)} · {r.email}
                </p>
              </div>
              <Badge
                className={cn(
                  'text-[10px] font-bold border shrink-0',
                  orgAccessPillClass(r.access_role),
                )}
              >
                {orgAccessLabelDe(r.access_role)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
