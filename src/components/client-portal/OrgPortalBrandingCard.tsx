/**
 * Shared logo + portal title editor for SYSTEM_ADMIN (per org) and CLIENT_ADMIN (own org).
 */

import { useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useTranslation } from '../../lib/context/I18nContext';
import {
  ORG_LOGO_ALLOWED_MIME,
  ORG_LOGO_MAX_BYTES,
  organizationInitials,
  resolvePortalTitle,
} from '../../lib/client-portal/org-branding';

export interface OrgPortalBrandingCardProps {
  organizationName: string;
  logoUrl: string | null;
  portalTitle: string | null;
  saving?: boolean;
  onSave: (payload: {
    logoDataUrl?: string | null;
    portal_title?: string | null;
    clearLogo?: boolean;
  }) => Promise<void>;
}

export function OrgPortalBrandingCard({
  organizationName,
  logoUrl,
  portalTitle,
  saving,
  onSave,
}: OrgPortalBrandingCardProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [titleDraft, setTitleDraft] = useState(portalTitle || '');
  const [busy, setBusy] = useState(false);
  const isBusy = Boolean(saving || busy);

  const previewTitle = resolvePortalTitle(organizationName, titleDraft || portalTitle);
  const initials = organizationInitials(organizationName);

  const readLogoFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ORG_LOGO_ALLOWED_MIME.has(file.type)) {
      toast.error(
        t(
          'orgBranding.invalidType',
          'Only PNG, JPEG, or WebP logos are allowed (no SVG).',
        ),
      );
      return;
    }
    if (file.size > ORG_LOGO_MAX_BYTES) {
      toast.error(t('orgBranding.tooLarge', 'Logo must be 512 KB or smaller.'));
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readLogoFile(file);
      await onSave({ logoDataUrl: dataUrl });
      toast.success(t('orgBranding.uploaded', 'Portal logo saved.'));
    } catch (err: any) {
      toast.error(err?.message || t('orgBranding.uploadFailed', 'Logo upload failed.'));
    } finally {
      setBusy(false);
    }
  };

  const clearLogo = async () => {
    setBusy(true);
    try {
      await onSave({ clearLogo: true });
      toast.success(t('orgBranding.cleared', 'Portal logo removed.'));
    } catch (err: any) {
      toast.error(err?.message || t('orgBranding.clearFailed', 'Could not remove logo.'));
    } finally {
      setBusy(false);
    }
  };

  const saveTitle = async () => {
    setBusy(true);
    try {
      await onSave({ portal_title: titleDraft.trim() || null });
      toast.success(t('orgBranding.titleSaved', 'Portal title saved.'));
    } catch (err: any) {
      toast.error(err?.message || t('orgBranding.titleFailed', 'Could not save title.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4 space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
          {t('orgBranding.title', 'Kunden-Portal Branding')}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          {t(
            'orgBranding.hint',
            'Logo (PNG/JPEG/WebP, max 512 KB) and optional portal title for CLIENT_* users.',
          )}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-start">
        <div className="w-16 h-16 rounded-xl border border-dashed border-slate-300 bg-white flex items-center justify-center overflow-hidden shrink-0">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="max-w-full max-h-full object-contain" />
          ) : (
            <span className="text-sm font-black text-slate-500">{initials}</span>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <p className="text-sm font-semibold text-slate-800 truncate">{previewTitle}</p>
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => void onFile(e)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isBusy}
              className="gap-1.5"
              onClick={() => inputRef.current?.click()}
            >
              {isBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ImagePlus className="w-3.5 h-3.5" />
              )}
              {t('orgBranding.upload', 'Upload logo')}
            </Button>
            {logoUrl ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isBusy}
                className="gap-1.5 text-rose-700"
                onClick={() => void clearLogo()}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t('orgBranding.remove', 'Remove')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] font-bold uppercase text-slate-400">
          {t('orgBranding.portalTitle', 'Portal title')}
        </Label>
        <div className="flex gap-2">
          <Input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            placeholder={`${organizationName} ServiceDesk`}
            maxLength={120}
          />
          <Button type="button" size="sm" disabled={isBusy} onClick={() => void saveTitle()}>
            {t('common.save', 'Save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
