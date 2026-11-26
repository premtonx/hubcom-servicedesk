import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Paperclip, Search, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { RichTextEditor } from '../../RichTextEditor';
import { cn } from '../../../lib/utils';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';
import {
  clientPortalApi,
  type PortalMember,
  type PortalTicketAttachment,
} from '../../../services/clientPortalApi';
import { PortalKbTicketSuggestPanel } from '../../client-portal/PortalKbTicketSuggestPanel';
import type { TicketPriority } from '../../../types';

const PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: 'low', label: 'Niedrig' },
  { value: 'medium', label: 'Normal' },
  { value: 'high', label: 'Hoch' },
  { value: 'urgent', label: 'Dringend' },
];

const CATEGORIES = [
  'Allgemein',
  'Hardware',
  'Software',
  'Netzwerk',
  'Zugriff / Accounts',
  'E-Mail',
  'Sonstiges',
];

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function fileToAttachment(file: File): Promise<PortalTicketAttachment> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      reject(new Error(`Datei zu groß (max. 5 MB): ${file.name}`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        contentBase64: base64,
      });
    };
    reader.onerror = () => reject(new Error(`Lesen fehlgeschlagen: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** Searchable multi-select with removable chips (no raw `<select multiple>`). */
function ParticipantChipPicker({
  members,
  selectedIds,
  onChange,
  excludeIds,
}: {
  members: PortalMember[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  excludeIds: string[];
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const available = useMemo(() => {
    const exclude = new Set(excludeIds);
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (exclude.has(m.id) || selectedIds.includes(m.id)) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q)
      );
    });
  }, [members, selectedIds, excludeIds, query]);

  const selected = useMemo(
    () => members.filter((m) => selectedIds.includes(m.id)),
    [members, selectedIds],
  );

  return (
    <div className="space-y-2">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 pl-2.5 pr-1 py-0.5 text-[11px] font-semibold text-slate-700"
            >
              <span className="truncate max-w-[140px]">{m.name || m.email}</span>
              <button
                type="button"
                className="rounded-full p-0.5 text-slate-400 hover:text-rose-600 hover:bg-white"
                onClick={() => onChange(selectedIds.filter((id) => id !== m.id))}
                aria-label={`${m.name || m.email} entfernen`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          className="pl-8 h-9 text-sm"
          placeholder="Kollegen suchen…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so option click registers.
            window.setTimeout(() => setOpen(false), 150);
          }}
        />
        {open && available.length > 0 ? (
          <ul className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg py-1">
            {available.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex flex-col gap-0.5"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange([...selectedIds, m.id]);
                    setQuery('');
                    setOpen(false);
                  }}
                >
                  <span className="font-semibold text-slate-800 truncate">
                    {m.name || m.email}
                  </span>
                  <span className="text-[11px] text-slate-500 truncate">
                    {m.email} · {m.role.replace('CLIENT_', '')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export default function ClientCreateTicketPage() {
  const { session, isOrgWide } = useClientPortalSession();
  const navigate = useNavigate();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<PortalTicketAttachment[]>([]);
  const [members, setMembers] = useState<PortalMember[]>([]);
  const [onBehalfOf, setOnBehalfOf] = useState('');
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!isOrgWide) return;
    void clientPortalApi
      .listMembers()
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [isOrgWide]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const next: PortalTicketAttachment[] = [];
      for (const file of Array.from(files)) {
        next.push(await fileToAttachment(file));
      }
      setAttachments((prev) => [...prev, ...next].slice(0, 10));
    } catch (err: any) {
      toast.error(err?.message || 'Anhang fehlgeschlagen');
    }
  };

  const submit = async () => {
    if (!session) return;
    if (!subject.trim() || !description.trim() || description === '<p><br></p>') {
      toast.error('Betreff und Beschreibung sind erforderlich.');
      return;
    }
    setSaving(true);
    try {
      const requesterId = isOrgWide && onBehalfOf ? onBehalfOf : session.id;
      const requester = members.find((m) => m.id === requesterId);
      const ticketId = await clientPortalApi.createTicket({
        subject: subject.trim(),
        description,
        priority,
        category,
        requesterId,
        participantIds: isOrgWide ? participantIds : [],
        attachments,
        customerName: requester?.name || session.name,
        customerEmail: requester?.email || session.email,
      });
      toast.success('Ticket erstellt.');
      navigate(`/portal/tickets/${ticketId}`, { replace: true });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || 'Erstellen fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 w-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 pb-12 space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            Neues Ticket erstellen
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Beschreiben Sie Ihr Anliegen — Hubcom Support meldet sich zeitnah.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: subject, description, attachments */}
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
              <div className="space-y-1.5">
                <Label className="text-sm font-bold text-slate-800">
                  Betreff <span className="text-rose-600">*</span>
                </Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Kurze Zusammenfassung des Problems"
                  className="h-11"
                />
              </div>

              <PortalKbTicketSuggestPanel
                subject={subject}
                descriptionPlain={description.replace(/<[^>]+>/g, ' ')}
                onResolved={() => {
                  toast.success(
                    'Schön, dass die Wissensdatenbank geholfen hat — Ticket wird nicht erstellt.',
                  );
                  navigate('/portal/tickets', { replace: true });
                }}
              />

              <div className="space-y-1.5">
                <Label className="text-sm font-bold text-slate-800">
                  Beschreibung <span className="text-rose-600">*</span>
                </Label>
                <div className="border border-slate-200 rounded-xl overflow-hidden min-h-[220px]">
                  <RichTextEditor value={description} onChange={setDescription} />
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-sm space-y-3">
              <Label className="text-sm font-bold text-slate-800">Anhänge</Label>
              <label
                className={cn(
                  'flex flex-col items-center justify-center gap-2 text-sm text-slate-600 border-2 border-dashed rounded-xl px-4 py-8 cursor-pointer transition-colors',
                  dragOver
                    ? 'border-blue-400 bg-blue-50/60'
                    : 'border-slate-300 hover:bg-slate-50 hover:border-slate-400',
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  void onFiles(e.dataTransfer.files);
                }}
              >
                <Upload className="w-6 h-6 text-slate-400" />
                <span className="font-semibold text-slate-700">
                  Dateien hierher ziehen oder auswählen
                </span>
                <span className="text-[11px] text-slate-400">
                  Screenshots, PDF, Logs — max. 5 MB je Datei
                </span>
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept="image/*,.pdf,.txt,.log,.zip"
                  onChange={(e) => void onFiles(e.target.files)}
                />
              </label>
              {attachments.length > 0 ? (
                <ul className="space-y-1.5">
                  {attachments.map((a) => (
                    <li
                      key={`${a.filename}-${a.size}`}
                      className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100"
                    >
                      <span className="flex items-center gap-2 truncate font-medium text-slate-700">
                        <Paperclip className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        {a.filename}{' '}
                        <span className="text-slate-400 font-normal">
                          ({Math.round(a.size / 1024)} KB)
                        </span>
                      </span>
                      <button
                        type="button"
                        className="text-slate-400 hover:text-rose-600 shrink-0"
                        onClick={() =>
                          setAttachments((prev) =>
                            prev.filter((x) => x.filename !== a.filename),
                          )
                        }
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {/* Right: ticket settings */}
          <div className="lg:col-span-1">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4 lg:sticky lg:top-6">
              <h2 className="text-sm font-black text-slate-900 tracking-tight">
                Ticket-Einstellungen
              </h2>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                  Kategorie / Thema
                </Label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                  Priorität
                </Label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TicketPriority)}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {isOrgWide ? (
                <>
                  <div className="border-t border-slate-100 pt-4 space-y-1.5">
                    <Label className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                      Erstellen im Namen von
                    </Label>
                    <select
                      className="w-full h-10 rounded-md border border-input bg-white px-3 text-sm"
                      value={onBehalfOf}
                      onChange={(e) => setOnBehalfOf(e.target.value)}
                    >
                      <option value="">Ich selbst</option>
                      {members
                        .filter((m) => m.id !== session?.id)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.email}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                      Teilnehmer hinzufügen
                    </Label>
                    <ParticipantChipPicker
                      members={members}
                      selectedIds={participantIds}
                      onChange={setParticipantIds}
                      excludeIds={[session?.id || '', onBehalfOf].filter(Boolean)}
                    />
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>

        {/* Sticky-feel footer actions */}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-slate-200/80">
          <Button
            type="button"
            variant="outline"
            className="min-w-[110px]"
            onClick={() => navigate('/portal/tickets')}
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="min-w-[160px] gap-2 bg-blue-600 hover:bg-blue-700 text-white"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Ticket erstellen
          </Button>
        </div>
      </div>
    </div>
  );
}
