import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Loader2, Pencil } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { cn } from '../../lib/utils';
import { statusBadgeClass } from './returns-layout-shared';
import { DeviceTypeSelect } from './DeviceTypeSelect';

/** Interactive status pill — saves immediately on select. */
export function InlineStatusSelect({
  value,
  statuses,
  onChange,
  disabled,
}: {
  value: string;
  statuses: string[];
  onChange: (status: string) => void;
  disabled?: boolean;
}) {
  const label = String(value || 'Neu').trim() || 'Neu';
  const options = statuses.includes(label) ? statuses : [label, ...statuses];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition hover:opacity-90',
          statusBadgeClass(label),
          disabled && 'opacity-60 cursor-not-allowed',
        )}
        title="Status ändern"
      >
        <span className="truncate max-w-[10rem]">{label}</span>
        <ChevronDown className="w-3 h-3 opacity-50 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[12rem] rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {options.map((s) => (
          <DropdownMenuItem
            key={s}
            className="text-xs font-semibold"
            onClick={(e) => {
              e.stopPropagation();
              onChange(s);
            }}
          >
            {s}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type DeviceFieldsPatch = {
  device_old_type: string | null;
  device_old_serial: string | null;
  device_new_type: string | null;
  device_new_serial: string | null;
};

/** Click-to-edit popover for ALT / NEU Gerätetyp + Seriennummer. */
export function DeviceSerialPopover({
  deviceTypes,
  initial,
  renderReadOnly,
  onSave,
}: {
  deviceTypes: string[];
  initial: DeviceFieldsPatch;
  renderReadOnly: ReactNode;
  onSave: (patch: DeviceFieldsPatch) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [oldType, setOldType] = useState(initial.device_old_type || '');
  const [oldSerial, setOldSerial] = useState(initial.device_old_serial || '');
  const [newType, setNewType] = useState(initial.device_new_type || '');
  const [newSerial, setNewSerial] = useState(initial.device_new_serial || '');

  useEffect(() => {
    if (!open) return;
    setOldType(initial.device_old_type || '');
    setOldSerial(initial.device_old_serial || '');
    setNewType(initial.device_new_type || '');
    setNewSerial(initial.device_new_serial || '');
  }, [open, initial.device_old_type, initial.device_old_serial, initial.device_new_type, initial.device_new_serial]);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({
        device_old_type: oldType.trim() || null,
        device_old_serial: oldSerial.trim() || null,
        device_new_type: newType.trim() || null,
        device_new_serial: newSerial.trim() || null,
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onClick={(e) => e.stopPropagation()}
        className="group relative w-full text-left rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
        title="Gerätetyp & Seriennummern bearbeiten"
      >
        <div className="pr-6">{renderReadOnly}</div>
        <span className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400">
          <Pencil className="w-3.5 h-3.5" />
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[22rem] p-3 space-y-3"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          }
        }}
      >
        <p className="text-xs font-black uppercase tracking-wide text-slate-700">
          Gerätetyp &amp; Seriennummern
        </p>
        <div className="space-y-2 rounded-lg border border-amber-100 bg-amber-50/40 p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800">
            Bestehendes Gerät (Alt)
          </p>
          <div className="space-y-1">
            <Label className="text-[10px] text-slate-500">Gerätetyp</Label>
            <DeviceTypeSelect
              size="sm"
              aria-label="Bestehendes Gerät (Alt)"
              value={oldType}
              onChange={setOldType}
              options={deviceTypes}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-slate-500">Seriennummer (Alt)</Label>
            <Input
              className="h-8 text-xs font-mono"
              value={oldSerial}
              onChange={(e) => setOldSerial(e.target.value)}
              placeholder="Seriennummer"
            />
          </div>
        </div>
        <div className="space-y-2 rounded-lg border border-sky-100 bg-sky-50/40 p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-sky-800">
            Neues Gerät (Neu)
          </p>
          <div className="space-y-1">
            <Label className="text-[10px] text-slate-500">Gerätetyp</Label>
            <DeviceTypeSelect
              size="sm"
              aria-label="Neues Gerät (Neu)"
              value={newType}
              onChange={setNewType}
              options={deviceTypes}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-slate-500">Seriennummer (Neu)</Label>
            <Input
              className="h-8 text-xs font-mono"
              value={newSerial}
              onChange={(e) => setNewSerial(e.target.value)}
              placeholder="Seriennummer"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={saving}
            onClick={() => setOpen(false)}
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 bg-blue-600 hover:bg-blue-700 text-white"
            disabled={saving}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
            Speichern
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
