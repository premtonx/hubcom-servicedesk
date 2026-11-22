import { useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, RotateCcw, Building2 } from 'lucide-react';
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

const MAX_LOGO_BYTES = 512 * 1024;

/**
 * Admin-Bereich: Firmenbranding — Platzhalter-SVG durch offizielles Hubcom-/Citadelle-Logo ersetzen.
 */
export function BrandingSettingsCard() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(() => getCustomLogoUrl());

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

  return (
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
  );
}
