import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { Button } from '../../ui/button';
import { Label } from '../../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';

export interface ReplacementOption {
  id: string;
  key?: string;
  name: string;
  disabled?: boolean;
}

interface ReplacementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  usageCount: number;
  options: ReplacementOption[];
  value: string;
  onValueChange: (value: string) => void;
  confirmLabel?: string;
  onConfirm: () => void;
  busy?: boolean;
}

export function ReplacementDialog({
  open,
  onOpenChange,
  title,
  description,
  usageCount,
  options,
  value,
  onValueChange,
  confirmLabel = 'Ersetzen und fortfahren',
  onConfirm,
  busy,
}: ReplacementDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="space-y-2 text-sm">
            <span className="block">{description}</span>
            <span className="block font-semibold text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              {usageCount} Ticket{usageCount === 1 ? '' : 's'} verwenden diesen Wert. Ohne Ersatz
              bleiben die Tickets unverändert — die Aktion wird abgebrochen.
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="replacement">Ersatzwert</Label>
          <Select value={value} onValueChange={onValueChange}>
            <SelectTrigger id="replacement" className="rounded-xl">
              <SelectValue placeholder="Bitte wählen…" />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.id} value={opt.key || opt.id} disabled={opt.disabled}>
                  {opt.name}
                  {opt.key ? ` (${opt.key})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            className="rounded-xl bg-[#0B1F3A] text-white"
            disabled={!value || busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
