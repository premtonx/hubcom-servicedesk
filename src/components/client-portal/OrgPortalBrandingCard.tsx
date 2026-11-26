/**
 * Shared logo + portal title + banner editor for SYSTEM_ADMIN (per org) and CLIENT_ADMIN (own org).
 */

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useTranslation } from '../../lib/context/I18nContext';
import {
  ORG_FAVICON_ALLOWED_MIME,
  ORG_FAVICON_MAX_BYTES,
  ORG_LOGO_ALLOWED_MIME,
  ORG_LOGO_MAX_BYTES,
  organizationInitials,
  resolvePortalTitle,
} from '../../lib/client-portal/org-branding';
import {
  DASHBOARD_BANNER_ALLOWED_MIME,
  DASHBOARD_BANNER_MAX_BYTES,
} from '../../lib/dashboard-banner-validate';

export interface OrgPortalBrandingCardProps {
  organizationName: string;
  logoUrl: string | null;
  portalTitle: string | null;
  bannerUrl?: string | null;
  faviconUrl?: string | null;
  saving?: boolean;
  onSave: (payload: {
    logoDataUrl?: string | null;
    portal_title?: string | null;
    clearLogo?: boolean;
  }) => Promise<void>;
  onBannerUpload?: (bannerDataUrl: string) => Promise<void>;
  onBannerRemove?: () => Promise<void>;
  onFaviconUpload?: (faviconDataUrl: string) => Promise<void>;
  onFaviconRemove?: () => Promise<void>;
}

export function OrgPortalBrandingCard({
  organizationName,
  logoUrl,
  portalTitle,
  bannerUrl,
  faviconUrl,
  saving,
  onSave,
  onBannerUpload,
  onBannerRemove,
  onFaviconUpload,
  onFaviconRemove,
}: OrgPortalBrandingCardProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const [titleDraft, setTitleDraft] = useState(portalTitle || '');
  const [busy, setBusy] = useState(false);
  const isBusy = Boolean(saving || busy);

  useEffect(() => {
    setTitleDraft(portalTitle || '');
  }, [portalTitle]);

  const previewTitle = resolvePortalTitle(organizationName, titleDraft || portalTitle);
  const initials = organizationInitials(organizationName);

  const readFileAsDataUrl = (file: File): Promise<string> =>
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
          'Nur PNG, JPEG oder WebP sind erlaubt (kein SVG).',
        ),
      );
      return;
    }
    if (file.size > ORG_LOGO_MAX_BYTES) {
      toast.error(t('orgBranding.tooLarge', 'Logo darf maximal 512 KB groß sein.'));
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await onSave({ logoDataUrl: dataUrl });
      toast.success(t('orgBranding.uploaded', 'Portal-Logo gespeichert.'));
    } catch (err: any) {
      toast.error(err?.message || t('orgBranding.uploadFailed', 'Logo-Upload fehlgeschlagen.'));
    } finally {
      setBusy(false);
    }
  };

  const clearLogo = async () => {
    setBusy(true);
    try {
      await onSave({ clearLogo: true });
      toast.success(t('orgBranding.cleared', 'Portal-Logo entfernt.'));
    } catch (err: any) {
      toast.error(err?.message || t('orgBranding.clearFailed', 'Logo konnte nicht entfernt werden.'));
    } finally {
      setBusy(false);
    }
  };

  const saveTitle = async () => {
    setBusy(true);
    try {
      await onSave({ portal_title: titleDraft.trim() || null });
      toast.success(t('orgBranding.titleSaved', 'Portal-Titel gespeichert.'));
    } catch (err: any) {
      toast.error(err?.message || t('orgBranding.titleFailed', 'Titel konnte nicht gespeichert werden.'));
    } finally {
      setBusy(false);
    }
  };

  const onBannerFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onBannerUpload) return;
    if (!DASHBOARD_BANNER_ALLOWED_MIME.has(file.type) || file.type.includes('svg')) {
      toast.error(
        t(
          'orgBranding.bannerInvalidType',
          'Nur PNG, JPEG oder WebP-Banner sind erlaubt (kein SVG).',
        ),
      );
      return;
    }
    if (file.size > DASHBOARD_BANNER_MAX_BYTES) {
      toast.error(t('orgBranding.bannerTooLarge', 'Banner darf maximal 2 MB groß sein.'));
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await onBannerUpload(dataUrl);
      toast.success(t('orgBranding.bannerUploaded', 'Portal-Banner gespeichert.'));
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error ||
          err?.message ||
          t('orgBranding.bannerFailed', 'Banner-Upload fehlgeschlagen.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const clearBanner = async () => {
    if (!onBannerRemove) return;
    setBusy(true);
    try {
      await onBannerRemove();
      toast.success(t('orgBranding.bannerCleared', 'Portal-Banner entfernt.'));
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error ||
          err?.message ||
          t('orgBranding.bannerClearFailed', 'Banner konnte nicht entfernt werden.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const onFaviconFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onFaviconUpload) return;
    if (!ORG_FAVICON_ALLOWED_MIME.has(file.type) || file.type.includes('svg')) {
      toast.error(
        t(
          'orgBranding.faviconInvalidType',
          'Nur PNG, JPEG, WebP oder ICO sind erlaubt (kein SVG).',
        ),
      );
      return;
    }
    if (file.size > ORG_FAVICON_MAX_BYTES) {
      toast.error(t('orgBranding.faviconTooLarge', 'Favicon darf maximal 256 KB groß sein.'));
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await onFaviconUpload(dataUrl);
      toast.success(t('orgBranding.faviconUploaded', 'Favicon gespeichert.'));
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error ||
          err?.message ||
          t('orgBranding.faviconFailed', 'Favicon-Upload fehlgeschlagen.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const clearFavicon = async () => {
    if (!onFaviconRemove) return;
    setBusy(true);
    try {
      await onFaviconRemove();
      toast.success(t('orgBranding.faviconCleared', 'Favicon entfernt.'));
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error ||
          err?.message ||
          t('orgBranding.faviconClearFailed', 'Favicon konnte nicht entfernt werden.'),
      );
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
            'Logo (PNG/JPEG/WebP, max. 512 KB) und optionaler Portal-Titel für CLIENT_*-Nutzer.',
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
              {t('orgBranding.upload', 'Logo hochladen')}
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
                {t('orgBranding.remove', 'Entfernen')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] font-bold uppercase text-slate-400">
          {t('orgBranding.portalTitle', 'Portal-Titel')}
        </Label>
        <div className="flex gap-2">
          <Input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            placeholder={`${organizationName} ServiceDesk`}
            maxLength={120}
          />
          <Button type="button" size="sm" disabled={isBusy} onClick={() => void saveTitle()}>
            {t('common.save', 'Speichern')}
          </Button>
        </div>
      </div>

      {onBannerUpload ? (
        <div className="space-y-3 pt-2 border-t border-slate-200/80">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {t('orgBranding.bannerTitle', 'Portal-Banner (Dashboard-Header)')}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {t(
                'orgBranding.bannerHint',
                'PNG/JPEG/WebP, max. 2 MB — erscheint im glassmorphen Dashboard-Header des Kunden-Portals.',
              )}
            </p>
          </div>
          <div
            className="w-full h-28 rounded-xl border border-dashed border-slate-300 overflow-hidden bg-gradient-to-br from-sky-50 via-blue-50 to-slate-100"
            style={
              bannerUrl
                ? {
                    backgroundImage: `url(${bannerUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }
                : undefined
            }
          />
          <div className="flex flex-wrap gap-2">
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => void onBannerFile(e)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isBusy}
              className="gap-1.5"
              onClick={() => bannerInputRef.current?.click()}
            >
              {isBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ImagePlus className="w-3.5 h-3.5" />
              )}
              {t('orgBranding.bannerUpload', 'Banner hochladen')}
            </Button>
            {bannerUrl && onBannerRemove ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isBusy}
                className="gap-1.5 text-rose-700"
                onClick={() => void clearBanner()}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t('orgBranding.remove', 'Entfernen')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {onFaviconUpload ? (
        <div className="space-y-3 pt-2 border-t border-slate-200/80">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {t('orgBranding.faviconTitle', 'Favicon (Browser-Tab)')}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {t(
                'orgBranding.faviconHint',
                'PNG, JPEG, WebP oder ICO, max. 256 KB — erscheint im Browser-Tab des Kunden-Portals.',
              )}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <div className="w-12 h-12 rounded-lg border border-dashed border-slate-300 bg-white flex items-center justify-center overflow-hidden shrink-0">
              {faviconUrl ? (
                <img src={faviconUrl} alt="" className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-[10px] font-bold text-slate-400">ICO</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={faviconInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon,.ico"
                className="hidden"
                onChange={(e) => void onFaviconFile(e)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isBusy}
                className="gap-1.5"
                onClick={() => faviconInputRef.current?.click()}
              >
                {isBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="w-3.5 h-3.5" />
                )}
                {t('orgBranding.faviconUpload', 'Favicon hochladen')}
              </Button>
              {faviconUrl && onFaviconRemove ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isBusy}
                  className="gap-1.5 text-rose-700"
                  onClick={() => void clearFavicon()}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('orgBranding.remove', 'Entfernen')}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
