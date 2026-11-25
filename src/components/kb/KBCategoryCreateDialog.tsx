import { useEffect, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { useTranslation } from '../../lib/context/I18nContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { mapDbCategoryToRecord, type KBCategoryRecord } from './kbCategoryUtils';
import type { KBCategoryDto } from '../../services/kbDashboardApi';
import { toast } from 'sonner';

interface KBCategoryCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: KBCategoryRecord[];
  onCategoriesChange: (categories: KBCategoryRecord[]) => void;
  /** Shared adapter create — staff /api/kb/categories or portal /api/portal/kb/categories. */
  onCreate: (payload: { name: string; desc?: string; order?: number }) => Promise<KBCategoryDto>;
  /** When set, newly created category is applied to the open article draft. */
  onCreated?: (category: KBCategoryRecord) => void;
}

export function KBCategoryCreateDialog({
  open,
  onOpenChange,
  categories,
  onCategoriesChange,
  onCreate,
  onCreated,
}: KBCategoryCreateDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setDesc('');
    }
  }, [open]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const category = await onCreate({
        name: name.trim(),
        desc: desc.trim(),
        order: categories.length + 1,
      });
      const record = mapDbCategoryToRecord(category, categories.length + 1);
      onCategoriesChange([...categories, record]);
      onCreated?.(record);
      toast.success(t('kb.categoryAdd.success', 'Kategorie erstellt.'));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kategorie konnte nicht erstellt werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FolderPlus className="w-4 h-4 text-indigo-600" />
            {t('kb.categoryAdd.title', 'Kategorie erstellen')}
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            {t(
              'kb.categoryAdd.description',
              'Neue Kategorie für Ihre Wissensdatenbank — sofort in der Artikelauswahl verfügbar.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">{t('kb.categoryAdd.name', 'Name')}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('kb.categoryAdd.namePlaceholder', 'z. B. Hardware & Geräte')}
              className="h-10"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">
              {t('kb.categoryAdd.desc', 'Beschreibung (optional)')}
            </Label>
            <Input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={t('kb.categoryAdd.descPlaceholder', 'Kurzbeschreibung…')}
              className="h-10"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel', 'Abbrechen')}
          </Button>
          <Button type="button" onClick={() => void handleCreate()} disabled={busy || !name.trim()}>
            {busy
              ? t('kb.categoryAdd.saving', 'Speichern…')
              : t('kb.categoryAdd.submit', 'Erstellen')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
