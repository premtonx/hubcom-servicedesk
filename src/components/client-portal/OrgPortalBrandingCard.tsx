/**
 * Shared logo + portal title + banner editor for SYSTEM_ADMIN (per org) and CLIENT_ADMIN (own org).
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import { ImagePlus, Loader2, Moon, Monitor, RotateCcw, Sun, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { useTranslation } from '../../lib/context/I18nContext';
import { cn } from '../../lib/utils';
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
import { extractDominantLogoColors } from '../../lib/client-portal/extract-logo-colors';
import {
  contrastForeground,
  DEFAULT_PORTAL_THEME,
  normalizeOptionalPortalHex,
  normalizePortalHex,
  type PortalThemeMode,
  type PortalThemeSettings,
} from '../../lib/client-portal/portal-theme';

export interface OrgPortalBrandingCardProps {
  organizationName: string;
  logoUrl: string | null;
  portalTitle: string | null;
  bannerUrl?: string | null;
  faviconUrl?: string | null;
  theme?: Partial<PortalThemeSettings> | null;
  saving?: boolean;
  onSave: (payload: {
    logoDataUrl?: string | null;
    portal_title?: string | null;
    clearLogo?: boolean;
    primaryColor?: string;
    secondaryColor?: string;
    sidebarColor?: string | null;
    themeMode?: PortalThemeMode;
    allowUserThemeToggle?: boolean;
  }) => Promise<void>;
  onBannerUpload?: (bannerDataUrl: string) => Promise<void>;
  onBannerRemove?: () => Promise<void>;
  onFaviconUpload?: (faviconDataUrl: string) => Promise<void>;
  onFaviconRemove?: () => Promise<void>;
}

function ColorField({
  label,
  value,
  nullable,
  disabled,
  onChange,
}: {
  label: string;
  value: string | null;
  nullable?: boolean;
  disabled?: boolean;
  onChange: (next: string | null) => void;
}) {
  const display = value || '#FFFFFF';
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] font-bold uppercase text-slate-400">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={display}
          disabled={disabled}
          className="h-9 w-10 rounded-md border border-slate-200 bg-white cursor-pointer disabled:opacity-50"
          onChange={(e) => onChange(normalizePortalHex(e.target.value, display))}
        />
        <Input
          value={value ?? ''}
          disabled={disabled}
          placeholder={nullable ? 'auto' : '#2563EB'}
          className="font-mono text-xs uppercase"
          maxLength={7}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (nullable && !raw) {
              onChange(null);
              return;
            }
            onChange(raw.startsWith('#') ? raw : `#${raw}`);
          }}
          onBlur={() => {
            if (nullable && !value) {
              onChange(null);
              return;
            }
            const next = nullable
              ? normalizeOptionalPortalHex(value)
              : normalizePortalHex(value, DEFAULT_PORTAL_THEME.primaryColor);
            onChange(next);
          }}
        />
        {nullable ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || value == null}
            onClick={() => onChange(null)}
          >
            Auto
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function OrgPortalBrandingCard({
  organizationName,
  logoUrl,
  portalTitle,
  bannerUrl,
  faviconUrl,
  theme,
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
  const [primaryColor, setPrimaryColor] = useState(
    theme?.primaryColor || DEFAULT_PORTAL_THEME.primaryColor,
  );
  const [secondaryColor, setSecondaryColor] = useState(
    theme?.secondaryColor || DEFAULT_PORTAL_THEME.secondaryColor,
  );
  const [sidebarColor, setSidebarColor] = useState<string | null>(
    theme?.sidebarColor ?? null,
  );
  const [themeMode, setThemeMode] = useState<PortalThemeMode>(
    theme?.themeMode || DEFAULT_PORTAL_THEME.themeMode,
  );
  const [allowUserThemeToggle, setAllowUserThemeToggle] = useState(
    theme?.allowUserThemeToggle !== false,
  );
  const [previewDark, setPreviewDark] = useState(false);
  const isBusy = Boolean(saving || busy);

  useEffect(() => {
    setTitleDraft(portalTitle || '');
  }, [portalTitle]);

  useEffect(() => {
    setPrimaryColor(theme?.primaryColor || DEFAULT_PORTAL_THEME.primaryColor);
    setSecondaryColor(theme?.secondaryColor || DEFAULT_PORTAL_THEME.secondaryColor);
    setSidebarColor(theme?.sidebarColor ?? null);
    setThemeMode(theme?.themeMode || DEFAULT_PORTAL_THEME.themeMode);
    setAllowUserThemeToggle(theme?.allowUserThemeToggle !== false);
  }, [
    theme?.primaryColor,
    theme?.secondaryColor,
    theme?.sidebarColor,
    theme?.themeMode,
    theme?.allowUserThemeToggle,
  ]);

  const previewSidebarBg = sidebarColor || (previewDark ? '#111827' : '#FFFFFF');
  const previewVars = useMemo(
    () => ({
      '--portal-primary': primaryColor,
      '--portal-primary-foreground': contrastForeground(primaryColor),
      '--portal-secondary': secondaryColor,
      '--portal-sidebar-bg': previewSidebarBg,
      '--portal-sidebar-fg': contrastForeground(previewSidebarBg),
    }),
    [primaryColor, secondaryColor, previewSidebarBg],
  );

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
          {t('orgBranding.portalTitle', 'Browser-Tab-Titel / Portal-Titel')}
        </Label>
        <p className="text-[11px] text-slate-500">
          {t(
            'orgBranding.portalTitleHint',
            'Erscheint im Browser-Tab auf allen /portal/*-Seiten (z. B. „DPG ServiceDesk“).',
          )}
        </p>
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

      <div className="space-y-4 pt-3 border-t border-slate-200/80">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {t('orgBranding.colorsTitle', 'Farben & Erscheinungsbild')}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {t(
              'orgBranding.colorsHint',
              'Primär-, Sekundär- und optionale Sidebar-Farbe sowie Hell/Dunkel für das Kunden-Portal.',
            )}
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-[10px] font-bold uppercase text-slate-400">
            {t('orgBranding.designMode', 'Design-Modus')}
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                { id: 'light' as const, label: 'Hell (Standard)', icon: Sun },
                { id: 'dark' as const, label: 'Dunkel', icon: Moon },
                { id: 'system' as const, label: 'System', icon: Monitor },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={isBusy}
                onClick={() => setThemeMode(opt.id)}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition-colors flex items-center gap-2',
                  themeMode === opt.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                )}
              >
                <opt.icon className="w-3.5 h-3.5 shrink-0" />
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-800">
                {t('orgBranding.allowToggle', 'Nutzer-Umschaltung im Portal erlauben')}
              </p>
              <p className="text-[11px] text-slate-500">
                {t(
                  'orgBranding.allowToggleHint',
                  'Zeigt einen Hell/Dunkel-Schalter über „Abmelden“ in der Portal-Sidebar.',
                )}
              </p>
            </div>
            <Switch
              checked={allowUserThemeToggle}
              disabled={isBusy}
              onCheckedChange={setAllowUserThemeToggle}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ColorField
            label={t('orgBranding.primaryColor', 'Primärfarbe')}
            value={primaryColor}
            disabled={isBusy}
            onChange={(v) => setPrimaryColor(v || DEFAULT_PORTAL_THEME.primaryColor)}
          />
          <ColorField
            label={t('orgBranding.secondaryColor', 'Sekundärfarbe')}
            value={secondaryColor}
            disabled={isBusy}
            onChange={(v) => setSecondaryColor(v || DEFAULT_PORTAL_THEME.secondaryColor)}
          />
          <ColorField
            label={t('orgBranding.sidebarColor', 'Sidebar-Farbe (optional)')}
            value={sidebarColor}
            nullable
            disabled={isBusy}
            onChange={setSidebarColor}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isBusy || !logoUrl}
            className="gap-1.5"
            onClick={() => {
              void (async () => {
                if (!logoUrl) return;
                setBusy(true);
                try {
                  const colors = await extractDominantLogoColors(logoUrl, 3);
                  if (!colors.length) {
                    toast.error(
                      t(
                        'orgBranding.logoColorsEmpty',
                        'Im Logo wurden keine geeigneten Farben gefunden.',
                      ),
                    );
                    return;
                  }
                  setPrimaryColor(colors[0] || DEFAULT_PORTAL_THEME.primaryColor);
                  setSecondaryColor(colors[1] || colors[0] || DEFAULT_PORTAL_THEME.secondaryColor);
                  if (colors[2]) setSidebarColor(colors[2]);
                  toast.success(
                    t('orgBranding.logoColorsApplied', 'Farben aus Logo übernommen.'),
                  );
                } catch (err: any) {
                  toast.error(
                    err?.message ||
                      t('orgBranding.logoColorsFailed', 'Farben konnten nicht extrahiert werden.'),
                  );
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <Wand2 className="w-3.5 h-3.5" />
            {t('orgBranding.fromLogo', 'Farben aus Logo übernehmen')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isBusy}
            className="gap-1.5"
            onClick={() => {
              setPrimaryColor(DEFAULT_PORTAL_THEME.primaryColor);
              setSecondaryColor(DEFAULT_PORTAL_THEME.secondaryColor);
              setSidebarColor(null);
              setThemeMode(DEFAULT_PORTAL_THEME.themeMode);
              setAllowUserThemeToggle(true);
            }}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t('orgBranding.resetColors', 'Auf Standard zurücksetzen')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isBusy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                try {
                  await onSave({
                    primaryColor: normalizePortalHex(
                      primaryColor,
                      DEFAULT_PORTAL_THEME.primaryColor,
                    ),
                    secondaryColor: normalizePortalHex(
                      secondaryColor,
                      DEFAULT_PORTAL_THEME.secondaryColor,
                    ),
                    sidebarColor: normalizeOptionalPortalHex(sidebarColor),
                    themeMode,
                    allowUserThemeToggle,
                  });
                  toast.success(
                    t('orgBranding.themeSaved', 'Farben & Erscheinungsbild gespeichert.'),
                  );
                } catch (err: any) {
                  toast.error(
                    err?.response?.data?.error ||
                      err?.message ||
                      t('orgBranding.themeFailed', 'Theme konnte nicht gespeichert werden.'),
                  );
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {t('orgBranding.saveTheme', 'Farben speichern')}
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-[10px] font-bold uppercase text-slate-400">
              {t('orgBranding.livePreview', 'Live-Vorschau')}
            </Label>
            <button
              type="button"
              className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
              onClick={() => setPreviewDark((v) => !v)}
            >
              {previewDark ? 'Hell anzeigen' : 'Dunkel anzeigen'}
            </button>
          </div>
          <div
            className={cn(
              'rounded-xl border overflow-hidden grid grid-cols-[88px_1fr] min-h-[120px]',
              previewDark ? 'border-slate-700' : 'border-slate-200',
            )}
            style={previewVars as CSSProperties}
          >
            <div
              className="p-2.5 flex flex-col gap-1.5"
              style={{
                background: 'var(--portal-sidebar-bg)',
                color: 'var(--portal-sidebar-fg)',
              }}
            >
              <div className="text-[9px] font-black uppercase tracking-wide opacity-70">Portal</div>
              <div
                className="rounded-md px-1.5 py-1 text-[10px] font-bold"
                style={{
                  background: 'var(--portal-primary)',
                  color: 'var(--portal-primary-foreground)',
                }}
              >
                Übersicht
              </div>
              <div className="rounded-md px-1.5 py-1 text-[10px] font-semibold opacity-80">
                Tickets
              </div>
            </div>
            <div
              className="p-3 space-y-2"
              style={{
                background: previewDark ? '#0B1120' : '#F8FAFC',
                color: previewDark ? '#E2E8F0' : '#0F172A',
              }}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-md px-2.5 py-1 text-[10px] font-bold"
                  style={{
                    background: 'var(--portal-primary)',
                    color: 'var(--portal-primary-foreground)',
                  }}
                >
                  Aktion
                </button>
                <span
                  className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                  style={{
                    background: 'var(--portal-secondary)',
                    color: contrastForeground(secondaryColor),
                  }}
                >
                  Badge
                </span>
              </div>
              <div
                className="rounded-lg border p-2 text-[10px]"
                style={{
                  background: previewDark ? '#111827' : '#FFFFFF',
                  borderColor: previewDark ? '#1E293B' : '#E2E8F0',
                }}
              >
                Kartenfläche · {previewDark ? 'Dunkel' : 'Hell'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
