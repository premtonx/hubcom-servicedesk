import { useEffect, useState } from 'react';
import axios from 'axios';
import { Loader2, Package } from 'lucide-react';
import { ReturnsWorkbench } from '../returns/ReturnsWorkbench';

type OrgOption = { id: string; name: string; enabled: boolean };

export default function StaffReturnsPage() {
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [orgId, setOrgId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void axios
      .get('/api/admin/organizations', { withCredentials: true })
      .then((res) => {
        if (!active) return;
        const rows = (res.data?.organizations || []) as Array<Record<string, any>>;
        const enabled = rows
          .filter((o) => o.hardware_returns_enabled || o.enabledModules?.hardwareReturns)
          .map((o) => ({
            id: String(o.id),
            name: String(o.name || o.id),
            enabled: true,
          }));
        setOrgs(enabled);
        if (enabled.length && !orgId) setOrgId(enabled[0].id);
      })
      .catch(() => {
        if (active) setOrgs([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="p-10 flex items-center justify-center text-slate-500 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Laden…
      </div>
    );
  }

  if (!orgs.length) {
    return (
      <div className="p-10 max-w-xl mx-auto text-center space-y-3">
        <Package className="w-8 h-8 mx-auto text-slate-400" />
        <h1 className="text-lg font-black">Rücklieferungen</h1>
        <p className="text-sm text-slate-500">
          Keine Organisation hat das Modul Hardware-Rücklieferungen aktiviert.
          Aktivieren Sie es unter Kunden → Kunden-Portal &amp; Branding.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full px-6 py-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-bold text-slate-600">Organisation</label>
        <select
          className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold"
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
        >
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      {orgId ? (
        <ReturnsWorkbench mode="staff" organizationId={orgId} canEditSettings canImportCsv />
      ) : null}
    </div>
  );
}
