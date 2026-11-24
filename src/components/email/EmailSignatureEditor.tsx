/**
 * Shared signature HTML + logo editor for Admin Hub channels and Client Portal.
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { cn } from '../../lib/utils';
import {
  DEFAULT_HUBCOM_SIGNATURE_HTML,
  SIGNATURE_LOGO_ALLOWED_MIME,
  SIGNATURE_LOGO_MAX_BYTES,
  renderSignatureHtml,
} from '../../lib/email-signature';
import { sanitizeTimelineHtml } from '../../lib/sanitize-html';

const PLACEHOLDER_CHIPS = [
  '{{agent.name}}',
  '{{agent.title}}',
  '{{agent.phone}}',
  '{{agent.email}}',
  '{{agent.title_block}}',
  '{{agent.phone_block}}',
  '{{ticket.number}}',
  '{{organization.name}}',
  '{{channel.logo}}',
] as const;

export interface EmailSignatureEditorValue {
  signature_enabled: boolean;
  signature_html: string;
  signature_logo_data: string | null;
  signature_logo_mime: string | null;
}

export interface EmailSignatureEditorProps {
  value: EmailSignatureEditorValue;
  onChange: (next: EmailSignatureEditorValue) => void;
  previewAgent?: {
    name?: string;
    title?: string;
    phone?: string;
    email?: string;
  };
  organizationName?: string;
  className?: string;
  saving?: boolean;
}

export function EmailSignatureEditor({
  value,
  onChange,
  previewAgent,
  organizationName,
  className,
  saving,
}: EmailSignatureEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busyLogo, setBusyLogo] = useState(false);

  const previewHtml = useMemo(() => {
    return sanitizeTimelineHtml(
      renderSignatureHtml({
        channel: {
          signature_enabled: value.signature_enabled,
          signature_html: value.signature_html || DEFAULT_HUBCOM_SIGNATURE_HTML,
          signature_logo_data: value.signature_logo_data,
          signature_logo_mime: value.signature_logo_mime,
        },
        agent: {
          name: previewAgent?.name || 'Max Mustermann',
          title: previewAgent?.title || 'IT-Systemengineer',
          phone: previewAgent?.phone || '+49 6201 39093-30',
          email: previewAgent?.email || 'max.mustermann@hubcom.de',
        },
        ticket: { number: 'T-12345678' },
        organization: { name: organizationName || 'Hubcom GmbH' },
        forPreview: true,
      }),
    );
  }, [value, previewAgent, organizationName]);

  const insertChip = (chip: string) => {
    onChange({
      ...value,
      signature_html: `${value.signature_html || ''}${chip}`,
    });
  };

  const onLogo = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!SIGNATURE_LOGO_ALLOWED_MIME.has(file.type)) {
      toast.error('Only PNG, JPEG, or WebP logos are allowed (no SVG).');
      return;
    }
    if (file.size > SIGNATURE_LOGO_MAX_BYTES) {
      toast.error('Signature logo must be 256 KB or smaller.');
      return;
    }
    setBusyLogo(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      onChange({
        ...value,
        signature_logo_data: dataUrl,
        signature_logo_mime: file.type,
      });
      toast.success('Signature logo ready.');
    } catch {
      toast.error('Logo could not be read.');
    } finally {
      setBusyLogo(false);
    }
  };

  useEffect(() => {
    if (!value.signature_html) {
      onChange({ ...value, signature_html: DEFAULT_HUBCOM_SIGNATURE_HTML });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once when empty
  }, []);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">E-Mail-Signatur</p>
          <p className="text-xs text-slate-500">
            Angehängt nur bei ausgehenden Kundenantworten (Microsoft Graph cid: Logo).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-600">Aktiv</Label>
          <Switch
            checked={value.signature_enabled}
            onCheckedChange={(checked) =>
              onChange({ ...value, signature_enabled: Boolean(checked) })
            }
            disabled={saving}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PLACEHOLDER_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => insertChip(chip)}
            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-mono text-slate-600 hover:bg-white hover:border-slate-300"
          >
            {chip}
          </button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 text-[10px]"
          onClick={() =>
            onChange({ ...value, signature_html: DEFAULT_HUBCOM_SIGNATURE_HTML })
          }
        >
          Hubcom Vorlage
        </Button>
      </div>

      <textarea
        value={value.signature_html}
        onChange={(e) => onChange({ ...value, signature_html: e.target.value })}
        rows={10}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
        spellCheck={false}
      />

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => void onLogo(e)}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={busyLogo || saving}
          onClick={() => inputRef.current?.click()}
        >
          {busyLogo ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ImagePlus className="w-3.5 h-3.5" />
          )}
          Logo hochladen
        </Button>
        {value.signature_logo_data ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 text-rose-700"
            onClick={() =>
              onChange({
                ...value,
                signature_logo_data: null,
                signature_logo_mime: null,
              })
            }
          >
            <Trash2 className="w-3.5 h-3.5" />
            Logo entfernen
          </Button>
        ) : null}
        <span className="text-[10px] text-slate-400">PNG/JPEG/WebP · max. 256 KB · inline cid:</span>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
          Live-Vorschau
        </p>
        <div
          className="prose prose-sm max-w-none text-slate-800"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </div>
    </div>
  );
}
