import { Building2 } from 'lucide-react';
import { BrandingSettingsCard } from '../settings/BrandingSettingsCard';
import { useTranslation } from '../../lib/context/I18nContext';

/**
 * Admin-Hub destination for Firmenbranding (logo / company mark).
 * Kept separate from Systemeinstellungen so the two hub cards no longer share a route.
 */
export default function BrandingAdminPage() {
  const { t } = useTranslation();

  return (
    <div className="flex-1 overflow-y-auto bg-[#fafafa]">
      <div className="p-6 sm:p-8 max-w-3xl mx-auto space-y-6 pb-24">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#E8F1F8] text-[#1B6CA8] flex items-center justify-center border border-[#1B6CA8]/15 shrink-0">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              {t('admin.branding.title', 'Firmenbranding')}
            </h1>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              {t(
                'admin.branding.subtitle',
                'Logo und Markenzeichen für Hubcom – Citadelle AG. Platzhalter durch das offizielle Logo ersetzen.',
              )}
            </p>
          </div>
        </div>

        <BrandingSettingsCard />
      </div>
    </div>
  );
}
