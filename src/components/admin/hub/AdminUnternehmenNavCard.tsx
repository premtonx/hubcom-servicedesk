import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowRight, Building2, Loader2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { useTranslation } from '../../../lib/context/I18nContext';

/**
 * Compact navigation card replacing the duplicate Client Organizations panel.
 * Opens the unified Unternehmen workspace (CRM + portal branding/admins).
 */
export function AdminUnternehmenNavCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/admin/organizations', { withCredentials: true });
      const orgs = (res.data?.organizations || []) as Array<{ is_active?: boolean }>;
      setActiveCount(orgs.filter((o) => o.is_active !== false).length);
    } catch {
      setActiveCount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="bg-white border border-slate-200/80 rounded-[2rem] p-6 shadow-sm flex flex-col sm:flex-row sm:items-center gap-5 justify-between">
      <div className="flex items-start gap-4 min-w-0">
        <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-black text-slate-900">
            {t('admin.unternehmenNav.title', 'Unternehmen & Kunden-Portale')}
          </h3>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">
            {t(
              'admin.unternehmenNav.hint',
              'Ein gemeinsames Kundenmodell: CRM-Unternehmen, White-Label-Branding und CLIENT_ADMIN in einer Ansicht.',
            )}
          </p>
          <p className="text-xs font-bold text-slate-700 mt-2 flex items-center gap-1.5">
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                {t('admin.unternehmenNav.loading', 'Lade Organisationen…')}
              </>
            ) : (
              <>
                <span className="text-lg font-black text-slate-900 tabular-nums">
                  {activeCount ?? '—'}
                </span>
                {t('admin.unternehmenNav.activeCount', 'aktive Kundenorganisationen')}
              </>
            )}
          </p>
        </div>
      </div>
      <Button
        type="button"
        onClick={() => navigate('/admin/customers')}
        className="shrink-0 rounded-xl gap-2 font-bold"
      >
        {t('admin.unternehmenNav.open', 'Unternehmen öffnen')}
        <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  );
}
