import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Button } from './button';
import { Loader2 } from 'lucide-react';

interface DeletePortalUserDialogProps {
  open: boolean;
  name: string;
  email: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeletePortalUserDialog({
  open,
  name,
  email,
  busy,
  onCancel,
  onConfirm,
}: DeletePortalUserDialogProps) {
  const displayName = name || email || 'Benutzer';
  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onCancel() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Portal-Benutzer entfernen</DialogTitle>
          <DialogDescription className="text-sm text-slate-600 leading-relaxed pt-1">
            Möchten Sie „{displayName}“ ({email || '—'}) wirklich entfernen? Der Portal-Zugang
            wird sofort widerrufen, bestehende Tickets bleiben erhalten und die E-Mail-Adresse
            wird wieder freigegeben.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={busy}
            className="font-bold"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
            Endgültig löschen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
