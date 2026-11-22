import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  fileToPortalAttachment,
  portalService,
  type PortalAttachment,
} from '../../services/portalService';
import type { TicketCategory } from '../../lib/ticket-categories/types';

const MAX_FILES = 5;
const MAX_BYTES = 5 * 1024 * 1024;

export function PortalCreateTicketPage() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [categoryId, setCategoryId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    portalService
      .categories()
      .then((cats) => {
        setCategories(cats);
        if (cats[0]) setCategoryId(cats[0].id);
      })
      .catch(() => toast.error('Kategorien konnten nicht geladen werden'));
  }, []);

  const onFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= MAX_FILES) {
        toast.error(`Maximal ${MAX_FILES} Dateien.`);
        break;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`„${file.name}“ ist größer als 5 MB.`);
        continue;
      }
      next.push(file);
    }
    setFiles(next);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (subject.trim().length < 3) {
      toast.error('Bitte einen aussagekräftigen Betreff angeben.');
      return;
    }
    if (!description.trim()) {
      toast.error('Bitte beschreiben Sie Ihr Anliegen.');
      return;
    }

    setSubmitting(true);
    try {
      let attachments: PortalAttachment[] = [];
      if (files.length > 0) {
        attachments = await Promise.all(files.map(fileToPortalAttachment));
      }
      const result = await portalService.createTicket({
        subject: subject.trim(),
        description: description.trim(),
        priority,
        categoryId: categoryId || null,
        attachments,
      });
      toast.success('Ticket wurde erstellt und an den Support übermittelt.');
      navigate(`/portal/tickets/${result.ticket.id}`, { replace: true });
    } catch (err: any) {
      toast.error(err?.message || 'Ticket konnte nicht erstellt werden');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link
          to="/portal"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-[#1B6CA8]"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Zurück zur Übersicht
        </Link>
        <h1 className="text-2xl font-black tracking-tight text-slate-900 mt-3">
          Neues Ticket erstellen
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Schildern Sie Ihr Anliegen — unser Team sieht es sofort in der Warteschlange.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-5 shadow-sm"
      >
        <div className="space-y-1.5">
          <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Betreff
          </Label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Kurze Zusammenfassung Ihres Anliegens"
            className="h-11 rounded-xl"
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Kategorie
            </Label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full h-11 rounded-xl border border-input bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              {categories.length === 0 ? (
                <option value="">Keine Kategorie</option>
              ) : (
                categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Dringlichkeit
            </Label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}
              className="w-full h-11 rounded-xl border border-input bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="low">Niedrig</option>
              <option value="medium">Mittel</option>
              <option value="high">Hoch</option>
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Beschreibung
          </Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Beschreiben Sie das Problem oder die Anfrage möglichst genau…"
            className="min-h-[160px] rounded-xl"
            required
          />
        </div>

        <div className="space-y-2">
          <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Dateien anhängen (optional)
          </Label>
          <label className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-3 text-sm text-slate-600 cursor-pointer hover:border-[#1B6CA8] hover:bg-sky-50/50 transition">
            <Paperclip className="w-4 h-4 text-slate-400" />
            <span>Dateien wählen (max. {MAX_FILES} × 5 MB)</span>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                onFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          {files.length > 0 ? (
            <ul className="space-y-1.5">
              {files.map((file, idx) => (
                <li
                  key={`${file.name}-${idx}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
                >
                  <span className="truncate font-medium text-slate-700">{file.name}</span>
                  <button
                    type="button"
                    className="text-slate-400 hover:text-rose-600"
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label="Datei entfernen"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => navigate('/portal')}>
            Abbrechen
          </Button>
          <Button type="submit" disabled={submitting} className="font-bold gap-1.5 min-w-[140px]">
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Wird gesendet…
              </>
            ) : (
              'Ticket absenden'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default PortalCreateTicketPage;
