import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import {
  emptyHardwareReturnForm,
  hardwareFormFromRecord,
  hardwareFormToPayload,
  HardwareReturnSections,
  type HardwareReturnFormState,
} from './HardwareReturnSections';

interface StaffHardwareReturnPanelProps {
  ticketId: string;
  organizationId: string | null | undefined;
}

/**
 * Staff ticket detail panel — loads only when the ticket's organization
 * has hardware_returns_enabled. Hidden for every other org.
 */
export function StaffHardwareReturnPanel({
  ticketId,
  organizationId,
}: StaffHardwareReturnPanelProps) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [form, setForm] = useState<HardwareReturnFormState>(emptyHardwareReturnForm());

  const load = useCallback(async () => {
    if (!ticketId || !organizationId) {
      setEnabled(false);
      return;
    }
    setLoading(true);
    try {
      const res = await axios.get(
        `/api/tickets/${encodeURIComponent(ticketId)}/hardware-return`,
        { withCredentials: true },
      );
      setEnabled(true);
      setForm(hardwareFormFromRecord(res.data?.hardwareReturn || null));
      setDirty(false);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404 || status === 403) {
        setEnabled(false);
      } else {
        setEnabled(false);
      }
    } finally {
      setLoading(false);
    }
  }, [ticketId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!enabled || !ticketId) return;
    setSaving(true);
    try {
      const res = await axios.put(
        `/api/tickets/${encodeURIComponent(ticketId)}/hardware-return`,
        hardwareFormToPayload(form),
        { withCredentials: true },
      );
      setForm(hardwareFormFromRecord(res.data?.hardwareReturn || null));
      setDirty(false);
      toast.success('Hardware-Rücklieferung gespeichert');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  if (!organizationId) return null;
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Hardware-Modul wird geladen…
      </div>
    );
  }
  if (!enabled) return null;

  return (
    <div className="space-y-3">
      <HardwareReturnSections
        value={form}
        onChange={(next) => {
          setForm(next);
          setDirty(true);
        }}
      />
      <div className="flex justify-end">
        <Button type="button" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          Hardware-Daten speichern
        </Button>
      </div>
    </div>
  );
}
