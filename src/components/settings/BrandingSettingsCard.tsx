import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, RotateCcw, Building2, Loader2, Image as ImageIcon, Globe } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { HubcomLogo, HubcomPlaceholderMark } from '../ui/HubcomLogo';
import {
  brandConfig,
  getCustomLogoUrl,
  setCustomLogoUrl,
} from '../../lib/brandConfig';
import { useTranslation } from '../../lib/context/I18nContext';
import {
  DASHBOARD_BANNER_ALLOWED_MIME,
  DASHBOARD_BANNER_MAX_BYTES,
  parseAndValidateDashboardBannerDataUrl,
} from '../../lib/dashboard-banner-validate';
import {
  SYSTEM_FAVICON_ALLOWED_MIME,
  SYSTEM_FAVICON_MAX_BYTES,
  parseAndValidateSystemFaviconDataUrl,
} from '../../lib/system-favicon-validate';
import { applyDocumentFavicon, DEFAULT_SYSTEM_FAVICON_HREF } from '../../lib/document-branding';

const MAX_LOGO_BYTES = 512 * 1024;

const FALLBACK_HERO_PREVIEW =
  'linear-gradient(135deg, #E8F0FE 0%, #EEF4FB 40%, #DCE9F8 70%, #C5D9F0 100%)';

/**
 * Admin-Bereich: Firmenbranding — Logo + Dashboard-Banner (SYSTEM_ADMIN).
 */
export function BrandingSettingsCard() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(() => getCustomLogoUrl());
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerBusy, setBannerBusy] = useState(false);
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  const [faviconBusy, setFaviconBusy] = useState(false);
  const [faviconLoaded, setFaviconLoaded] = useState(false);

  const loadBanner = useCallback(async () => {
    try {
      const res = await axios.get('/api/admin/dashboard-banner', { withCredentials: true });
      setBannerUrl(res.data?.imageDataUrl || null);
    } catch {
      /* ignore — page is SYSTEM_ADMIN gated upstream */
    } finally {
      setBannerLoaded(true);
    }
  }, []);

  const loadFavicon = useCallback(async () => {
    try {
      const res = await axios.get('/api/admin/system-favicon', { withCredentials: true });
      setFaviconUrl(res.data?.imageDataUrl || null);
    } catch {
      /* ignore */
    } finally {
      setFaviconLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadBanner();
    void loadFavicon();
  }, [loadBanner, loadFavicon]);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('settings.branding.invalidType', 'Bitte eine Bilddatei (PNG, SVG, JPG) wählen.'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(t('settings.branding.tooLarge', 'Logo zu groß (max. 512 KB).'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setCustomLogoUrl(dataUrl);
      setLogoUrl(dataUrl);
      toast.success(t('settings.branding.uploaded', 'Logo gespeichert. Es erscheint in Navigation und Login.'));
    };
    reader.onerror = () => toast.error(t('settings.branding.readError', 'Logo konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  };

  const resetLogo = () => {
    setCustomLogoUrl(null);
    setLogoUrl(null);
    toast.success(t('settings.branding.reset', 'Platzhalter-Logo wiederhergestellt.'));
  };

  const onBannerFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
      toast.error(t('settings.branding.bannerNoSvg', 'SVG-Banner sind nicht erlaubt.'));
      return;
    }
    if (!DASHBOARD_BANNER_ALLOWED_MIME.has(file.type)) {
      toast.error(
        t('settings.branding.bannerType', 'Nur PNG, JPEG oder WebP (max. 2 MB).'),
      );
      return;
    }
    if (file.size > DASHBOARD_BANNER_MAX_BYTES) {
      toast.error(t('settings.branding.bannerTooLarge', 'Banner zu groß (max. 2 MB).'));
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const imageDataUrl = String(reader.result || '');
      const check = parseAndValidateDashboardBannerDataUrl(imageDataUrl);
      if (check.ok === false) {
        toast.error(check.error);
        return;
      }
      setBannerBusy(true);
      try {
        const res = await axios.post(
          '/api/admin/dashboard-banner',
          { imageDataUrl: check.dataUrl },
          { withCredentials: true },
        );
        setBannerUrl(res.data?.imageDataUrl || check.dataUrl);
        toast.success(t('settings.branding.bannerSaved', 'Dashboard-Banner gespeichert.'));
      } catch (err: any) {
        toast.error(err?.response?.data?.error || 'Banner konnte nicht gespeichert werden.');
      } finally {
        setBannerBusy(false);
      }
    };
    reader.onerror = () =>
      toast.error(t('settings.branding.bannerReadError', 'Banner konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  };

  const resetBanner = async () => {
    setBannerBusy(true);
    try {
      await axios.delete('/api/admin/dashboard-banner', { withCredentials: true });
      setBannerUrl(null);
      toast.success(t('settings.branding.bannerReset', 'Banner auf Standard zurückgesetzt.'));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Banner konnte nicht zurückgesetzt werden.');
    } finally {
      setBannerBusy(false);
    }
  };

  const onFaviconFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!SYSTEM_FAVICON_ALLOWED_MIME.has(file.type)) {
      toast.error(
        t(
          'settings.branding.faviconType',
          'Nur PNG, SVG, WebP oder ICO (max. 256 KB).',
        ),
      );
      return;
    }
    if (file.size > SYSTEM_FAVICON_MAX_BYTES) {
      toast.error(t('settings.branding.faviconTooLarge', 'Favicon zu groß (max. 256 KB).'));
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const imageDataUrl = String(reader.result || '');
      const check = parseAndValidateSystemFaviconDataUrl(imageDataUrl);
      if (check.ok === false) {
        toast.error(check.error);
        return;
      }
      setFaviconBusy(true);
      try {
        const res = await axios.post(
          '/api/admin/system-favicon',
          { imageDataUrl: check.dataUrl },
          { withCredentials: true },
        );
        const next = res.data?.imageDataUrl || check.dataUrl;
        setFaviconUrl(next);
        applyDocumentFavicon(next);
        window.dispatchEvent(new CustomEvent('hubcom-system-favicon-changed'));
        toast.success(t('settings.branding.faviconSaved', 'System-Favicon gespeichert.'));
      } catch (err: any) {
        toast.error(err?.response?.data?.error || 'Favicon konnte nicht gespeichert werden.');
      } finally {
        setFaviconBusy(false);
      }
    };
    reader.onerror = () =>
      toast.error(t('settings.branding.faviconReadError', 'Favicon konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  };

  const resetFavicon = async () => {
    setFaviconBusy(true);
    try {
      await axios.delete('/api/admin/system-favicon', { withCredentials: true });
      setFaviconUrl(null);
      applyDocumentFavicon(DEFAULT_SYSTEM_FAVICON_HREF);
      window.dispatchEvent(new CustomEvent('hubcom-system-favicon-changed'));
      toast.success(t('settings.branding.faviconReset', 'Favicon auf Standard zurückgesetzt.'));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Favicon konnte nicht zurückgesetzt werden.');
    } finally {
      setFaviconBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-[2rem] border-slate-200/80 shadow-sm overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#1B6CA8]" />
            <CardTitle className="text-base">
              {t('settings.branding.title', 'Firmenbranding')}
            </CardTitle>
          </div>
          <CardDescription>
            {t(
              'settings.branding.description',
              brandConfig.logoUploadHint,
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            <div className="flex items-center justify-center w-28 h-28 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3">
              {logoUrl ? (
                <img src={logoUrl} alt={brandConfig.companyName} className="max-w-full max-h-full object-contain" />
              ) : (
                <HubcomPlaceholderMark className="w-20 h-20" />
              )}
            </div>
            <div className="flex-1 space-y-3 min-w-0">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t('settings.branding.company', 'Unternehmen')}
                </Label>
                <p className="text-sm font-semibold text-[#0B1F3A]">{brandConfig.companyName}</p>
              </div>
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t('settings.branding.product', 'Produkt')}
                </Label>
                <p className="text-sm font-semibold text-[#0B1F3A]">{brandConfig.productName}</p>
              </div>
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t('settings.branding.support', 'Support')}
                </Label>
                <p className="text-sm text-slate-600">
                  {brandConfig.supportEmail} · {brandConfig.supportDomain}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-[#E8F1F8]/60 border border-[#1B6CA8]/15 p-4">
            <p className="text-xs text-slate-600 mb-3">
              {t('settings.branding.preview', 'Vorschau in der Navigation:')}
            </p>
            <HubcomLogo size="xs" showText />
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="hidden"
              onChange={onFile}
            />
            <Button
              type="button"
              className="bg-[#0B1F3A] hover:bg-[#061525] text-white"
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus className="w-4 h-4 mr-2" />
              {t('settings.branding.upload', 'Offizielles Logo hochladen')}
            </Button>
            <Button type="button" variant="outline" onClick={resetLogo} disabled={!logoUrl}>
              <RotateCcw className="w-4 h-4 mr-2" />
              {t('settings.branding.resetBtn', 'Platzhalter wiederherstellen')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-[2rem] border-slate-200/80 shadow-sm overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#1B6CA8]" />
            <CardTitle className="text-base">
              {t('settings.branding.faviconTitle', 'Favicon (Browser-Tab)')}
            </CardTitle>
          </div>
          <CardDescription>
            {t(
              'settings.branding.faviconDescription',
              'Icon im Browser-Tab für Hubcom ServiceDesk (Staff). PNG, SVG, WebP oder ICO, max. 256 KB.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl border border-dashed border-slate-300 bg-white flex items-center justify-center overflow-hidden shrink-0">
              {faviconLoaded && faviconUrl ? (
                <img src={faviconUrl} alt="" className="max-w-full max-h-full object-contain" />
              ) : (
                <img
                  src={DEFAULT_SYSTEM_FAVICON_HREF}
                  alt=""
                  className="max-w-[28px] max-h-[28px] object-contain opacity-70"
                />
              )}
            </div>
            <p className="text-xs text-slate-500">
              {faviconUrl
                ? t('settings.branding.faviconPreviewCustom', 'Aktuelles System-Favicon')
                : t('settings.branding.faviconPreviewDefault', 'Standard-Favicon (/favicon.svg)')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={faviconInputRef}
              type="file"
              accept="image/png,image/webp,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,.ico"
              className="hidden"
              onChange={onFaviconFile}
            />
            <Button
              type="button"
              className="bg-[#0B1F3A] hover:bg-[#061525] text-white"
              disabled={faviconBusy}
              onClick={() => faviconInputRef.current?.click()}
            >
              {faviconBusy ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ImagePlus className="w-4 h-4 mr-2" />
              )}
              {t('settings.branding.faviconUpload', 'Favicon hochladen')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={faviconBusy || !faviconUrl}
              onClick={() => void resetFavicon()}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              {t('settings.branding.faviconResetBtn', 'Auf Standard zurücksetzen')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-[2rem] border-slate-200/80 shadow-sm overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-[#1B6CA8]" />
            <CardTitle className="text-base">
              {t('settings.branding.bannerTitle', 'Dashboard-Banner')}
            </CardTitle>
          </div>
          <CardDescription>
            {t(
              'settings.branding.bannerDescription',
              'Hero-Hintergrundbild auf dem Staff-Dashboard. PNG, JPEG oder WebP, max. 2 MB (kein SVG).',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="relative h-36 rounded-2xl border border-slate-200 overflow-hidden"
            style={{
              backgroundImage: bannerUrl
                ? `linear-gradient(90deg, rgba(238,244,251,0.92) 0%, rgba(238,244,251,0.35) 70%, transparent 100%), url("${String(bannerUrl).replace(/"/g, '%22')}")`
                : FALLBACK_HERO_PREVIEW,
              backgroundSize: 'cover',
              backgroundPosition: 'right center',
            }}
          >
            <div className="absolute inset-0 flex items-center px-5">
              <div>
                <p className="text-sm font-bold text-slate-800">
                  {bannerLoaded
                    ? bannerUrl
                      ? t('settings.branding.bannerPreviewCustom', 'Aktuelles Banner')
                      : t('settings.branding.bannerPreviewDefault', 'Standard-Verlauf')
                    : '…'}
                </p>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                  Live-Vorschau Staff-Dashboard
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onBannerFile}
            />
            <Button
              type="button"
              className="bg-[#0B1F3A] hover:bg-[#061525] text-white"
              disabled={bannerBusy}
              onClick={() => bannerInputRef.current?.click()}
            >
              {bannerBusy ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ImagePlus className="w-4 h-4 mr-2" />
              )}
              {t('settings.branding.bannerUpload', 'Banner hochladen')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={bannerBusy || !bannerUrl}
              onClick={() => void resetBanner()}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              {t('settings.branding.bannerResetBtn', 'Auf Standard zurücksetzen')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
