import {
  Building2,
  Globe,
  Mail,
  Edit3,
  ExternalLink,
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
  onPortalClick?: () => void;
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
  companies?: Company[];
  onSelectCompany?: (id: string) => void;
}

export default function CompanyHeader({
  company,
  onEditCompanyClick,
  onViewContractClick,
  onInviteClientAdminClick,
  onPortalClick,
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
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {sidebarCollapsed && onExpandSidebar ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onExpandSidebar}
              className="h-8 w-8 rounded-xl shrink-0"
              title={t('companies.expandList', 'Unternehmensliste einblenden')}
            >
              <PanelLeftOpen className="w-4 h-4" />
            </Button>
          ) : null}
          {sidebarCollapsed && companies && onSelectCompany ? (
            <Select value={company.id} onValueChange={onSelectCompany}>
              <SelectTrigger className="h-8 w-[200px] rounded-xl text-xs font-bold">
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
          {onPortalClick ? (
            <Button
              onClick={onPortalClick}
              variant="outline"
              size="sm"
              className="h-8 rounded-xl border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-bold text-xs gap-1.5 px-3 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" />
              {t('companies.portalTab', 'Kunden-Portal')}
            </Button>
          ) : null}
          {onInviteClientAdminClick ? (
            <Button
              onClick={onInviteClientAdminClick}
              variant="outline"
              size="sm"
              className="h-8 rounded-xl border-muted-foreground/15 text-foreground hover:bg-muted font-bold text-xs gap-1.5 px-3 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {t('companies.inviteClientAdmin', 'Portal-Admin einladen')}
            </Button>
          ) : null}
          <Button
            onClick={onEditCompanyClick}
            variant="outline"
            size="sm"
            className="h-8 rounded-xl border-muted-foreground/15 text-foreground hover:bg-muted font-bold text-xs gap-1.5 px-3 cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5" />
            {t('companies.editCompanyShort', 'Bearbeiten')}
          </Button>
        </div>
      </div>

      {/* Compact horizontal company card */}
      <div className="bg-background border border-muted rounded-2xl px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="w-12 h-12 rounded-xl bg-primary text-white text-sm font-black tracking-tight flex items-center justify-center shadow-inner shrink-0 overflow-hidden border border-primary/20">
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

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-black text-foreground tracking-tight leading-none truncate">
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
            {company.hasContract ? (
              company.contractStatus === 'ACTIVE' ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                  {t('companies.supportContract', 'Support-Vertrag')}: {t('companies.active', 'Aktiv')}
                </span>
              ) : company.contractStatus === 'EXPIRED' ? (
                <span className="text-[10px] font-black text-rose-600 bg-rose-500/10 px-2 py-0.5 rounded-full">
                  {t('companies.expired', 'Abgelaufen')}
                </span>
              ) : null
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground font-semibold">
            {company.domain ? (
              <span className="inline-flex items-center gap-1">
                <Mail className="w-3 h-3" />
                {company.domain}
              </span>
            ) : null}
            {company.website ? (
              <a
                href={
                  company.website.startsWith('http')
                    ? company.website
                    : `https://${company.website}`
                }
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-primary"
              >
                <Globe className="w-3 h-3" />
                {company.website}
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            ) : null}
            {company.branche ? (
              <span className="inline-flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                {company.branche}
              </span>
            ) : null}
            <span>
              {t('companies.customerSince', 'Kunde seit:')}{' '}
              <span className="text-foreground font-bold">{customerSince}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              {t('companies.accountOwner', 'Account-Inhaber:')}{' '}
              {accountOwner ? (
                <span className="text-foreground font-bold">{accountOwner}</span>
              ) : (
                <span className="text-foreground font-bold">
                  {t('companies.unassigned', 'Nicht zugewiesen')}
                </span>
              )}
            </span>
            {company.hasContract ? (
              <button
                type="button"
                onClick={onViewContractClick}
                className="text-primary font-bold hover:underline cursor-pointer"
              >
                {t('companies.viewContract', 'Vertrag anzeigen')}
              </button>
            ) : (
              <button
                type="button"
                onClick={onViewContractClick}
                className="text-primary font-bold hover:underline cursor-pointer"
              >
                {t('companies.configureContract', 'Vertrag konfigurieren')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
