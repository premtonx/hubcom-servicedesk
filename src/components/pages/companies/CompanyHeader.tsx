import {
  Building2,
  Globe,
  Mail,
  Edit3,
  MoreHorizontal,
  ExternalLink,
  ImagePlus,
  UserPlus,
  PanelLeftOpen,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { HydratedCompany } from './utils';
import { useTranslation } from '../../../lib/context/I18nContext';
import { Company } from '../../../types';

interface CompanyHeaderProps {
  company: HydratedCompany;
  onEditCompanyClick: () => void;
  onViewContractClick: () => void;
  onBrandingClick?: () => void;
  onInviteClientAdminClick?: () => void;
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
  companies?: Company[];
  onSelectCompany?: (id: string) => void;
}

export default function CompanyHeader({
  company,
  onEditCompanyClick,
  onViewContractClick,
  onBrandingClick,
  onInviteClientAdminClick,
  sidebarCollapsed,
  onExpandSidebar,
  companies,
  onSelectCompany,
}: CompanyHeaderProps) {
  const { t } = useTranslation();
  const initials = (company.name || '')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  const accountOwner =
    company.accountOwner && company.accountOwner.trim()
      ? company.accountOwner.trim()
      : '';
  const customerSince =
    company.customerSince && company.customerSince.trim()
      ? company.customerSince.trim()
      : '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {sidebarCollapsed && onExpandSidebar ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onExpandSidebar}
              className="h-9 w-9 rounded-xl shrink-0"
              title={t('companies.expandList', 'Unternehmensliste einblenden')}
            >
              <PanelLeftOpen className="w-4 h-4" />
            </Button>
          ) : null}
          {sidebarCollapsed && companies && onSelectCompany ? (
            <Select value={company.id} onValueChange={onSelectCompany}>
              <SelectTrigger className="h-9 w-[220px] rounded-xl text-xs font-bold">
                <SelectValue placeholder={t('companies.switchCompany', 'Unternehmen wechseln')} />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-semibold min-w-0">
              <span className="text-muted-foreground/70">{t('nav.companies', 'Unternehmen')}</span>
              <span>&gt;</span>
              <span className="text-foreground font-bold truncate">{company.name}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {onBrandingClick ? (
            <Button
              onClick={onBrandingClick}
              variant="outline"
              size="sm"
              className="h-9 rounded-xl border-muted-foreground/15 text-foreground hover:bg-muted font-bold text-xs gap-1.5 px-3 cursor-pointer"
            >
              <ImagePlus className="w-3.5 h-3.5" />
              {t('companies.branding', 'Branding')}
            </Button>
          ) : null}
          {onInviteClientAdminClick ? (
            <Button
              onClick={onInviteClientAdminClick}
              variant="outline"
              size="sm"
              className="h-9 rounded-xl border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-bold text-xs gap-1.5 px-3 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {t('companies.inviteClientAdmin', 'CLIENT_ADMIN einladen')}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-xl border-muted-foreground/15 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <MoreHorizontal className="w-4 h-4" />
          </Button>
          <Button
            onClick={onEditCompanyClick}
            variant="outline"
            size="sm"
            className="h-9 rounded-xl border-muted-foreground/15 text-foreground hover:bg-muted font-bold text-xs gap-1.5 px-4 cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5" />
            {t('companies.editCompany', 'Unternehmen bearbeiten')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-background border border-muted rounded-2xl p-5 flex flex-col md:flex-row gap-5 items-start">
          <div className="w-24 h-24 rounded-2xl bg-primary text-white text-3xl font-black tracking-tight flex items-center justify-center shadow-inner shrink-0 relative overflow-hidden group border border-primary/20">
            {company.logoUrl ? (
              <img
                src={company.logoUrl}
                alt={company.name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <span>{initials}</span>
            )}
          </div>

          <div className="space-y-4 flex-1 min-w-0">
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-2xl font-black text-foreground tracking-tight leading-tight">
                  {company.name}
                </h2>
                {company.tier ? (
                  <Badge
                    variant="secondary"
                    className="h-5 px-2 bg-muted text-muted-foreground font-extrabold uppercase text-[9px] tracking-wider rounded-md border-none"
                  >
                    {company.tier}
                  </Badge>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-2 text-xs text-muted-foreground font-semibold">
                {company.website && (
                  <a
                    href={
                      company.website.startsWith('http')
                        ? company.website
                        : `https://${company.website}`
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 hover:text-primary transition-colors"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    {company.website}
                    <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                  </a>
                )}
                {company.domain && (
                  <div className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" />
                    {company.domain}
                  </div>
                )}
                {company.branche && (
                  <div className="flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5" />
                    {company.branche}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-3 border-t border-muted text-xs text-muted-foreground font-semibold">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground/50">
                  {t('companies.customerSince', 'Kunde seit:')}
                </span>
                <span className="text-foreground font-bold">{customerSince}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground/50">
                  {t('companies.accountOwner', 'Account-Inhaber:')}
                </span>
                {accountOwner ? (
                  <div className="flex items-center gap-1.5 bg-muted/60 px-2 py-0.5 rounded-full text-foreground font-bold">
                    <span className="h-4 w-4 rounded-full bg-primary/25 text-[9px] font-black flex items-center justify-center text-primary uppercase shrink-0">
                      {accountOwner.charAt(0)}
                    </span>
                    <span>{accountOwner}</span>
                  </div>
                ) : (
                  <span className="text-foreground font-bold">
                    {t('companies.unassigned', 'Nicht zugewiesen')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-background border border-muted rounded-2xl p-5 flex flex-col justify-between shadow-xs">
          {company.hasContract ? (
            <>
              <div className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-widest">
                    {t('companies.supportContract', 'Support-Vertrag')}
                  </span>
                  {company.contractStatus === 'ACTIVE' ? (
                    <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded-full text-[9px] font-black">
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                      {t('companies.active', 'AKTIV')}
                    </div>
                  ) : company.contractStatus === 'EXPIRED' ? (
                    <div className="flex items-center gap-1.5 bg-rose-500/10 text-rose-600 px-2 py-0.5 rounded-full text-[9px] font-black">
                      {t('companies.expired', 'ABGELAUFEN')}
                    </div>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-y-2.5 text-xs font-semibold">
                  <div className="text-muted-foreground">{t('companies.plan', 'Tarif')}</div>
                  <div className="text-foreground font-bold text-right">
                    {company.contractPlan || '—'}
                  </div>
                  <div className="text-muted-foreground">{t('companies.sla', 'SLA')}</div>
                  <div className="text-foreground font-bold text-right">
                    {company.contractSla || '—'}
                  </div>
                  <div className="text-muted-foreground">
                    {t('companies.renewalDate', 'Verlängerungsdatum')}
                  </div>
                  <div className="text-foreground font-bold text-right text-muted-foreground/90">
                    {company.contractRenewalDate || '—'}
                  </div>
                  {company.monthlySpend ? (
                    <>
                      <div className="text-muted-foreground">
                        {t('companies.monthlyRate', 'Monatliche Rate')}
                      </div>
                      <div className="text-foreground font-bold text-right">
                        {company.monthlySpend}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>

              <Button
                onClick={onViewContractClick}
                variant="outline"
                size="sm"
                className="w-full mt-4 h-9 rounded-xl border-muted text-foreground hover:bg-muted/80 font-bold text-xs"
              >
                {t('companies.viewContract', 'Vertrag anzeigen')}
              </Button>
            </>
          ) : (
            <div className="flex flex-col justify-between h-full gap-4">
              <div className="space-y-2">
                <span className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-widest">
                  {t('companies.supportContract', 'Support-Vertrag')}
                </span>
                <p className="text-sm font-bold text-foreground">
                  {t('companies.noContract', 'Kein Vertrag hinterlegt')}
                </p>
                <p className="text-xs text-muted-foreground font-semibold">
                  {t(
                    'companies.noContractHint',
                    'Tarif, SLA und Verlängerungsdatum können im Vertrags-Tab hinterlegt werden.',
                  )}
                </p>
              </div>
              <Button
                onClick={onViewContractClick}
                size="sm"
                className="w-full h-9 rounded-xl font-bold text-xs"
              >
                {t('companies.configureContract', 'Vertrag konfigurieren')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
