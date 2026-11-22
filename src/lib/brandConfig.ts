/**
 * Zentrale Branding-Konfiguration für Hubcom ServiceDesk (Hubcom - Citadelle AG).
 * Logo-URL kann über Admin → Branding überschrieben werden (localStorage / spätere Persistenz).
 */

export const BRAND_STORAGE_KEYS = {
  logoUrl: 'hubcom_brand_logo_url',
  companyName: 'hubcom_brand_company_name',
} as const;

export const brandConfig = {
  /** Produktname in Navigation, Login, Browser-Tab */
  productName: 'Hubcom ServiceDesk',
  /** Kurzname für knappe UI-Stellen */
  productShortName: 'Hubcom',
  /** Juristischer Firmenname (Footer, E-Mails, Impressum) */
  companyName: 'Hubcom - Citadelle AG',
  /** Support-Domain (ohne Schema) */
  supportDomain: 'hubcom.ch',
  supportEmail: 'support@hubcom.ch',
  senderName: 'Hubcom ServiceDesk Support',
  emailSignatureHtml:
    '<p>Mit freundlichen Grüßen,<br><strong>Hubcom ServiceDesk Support</strong><br>Hubcom - Citadelle AG</p>',
  /** Browser-Tab & Meta */
  documentTitle: 'Hubcom ServiceDesk',
  documentDescription:
    'Hubcom ServiceDesk von Hubcom - Citadelle AG — selbstgehostetes IT-Service-Management, Wissensdatenbank, Tresor und lokale KI.',
  /** Copyright-Zeile */
  copyrightYear: 2026,
  get copyrightLine() {
    return `© ${this.copyrightYear} ${this.companyName}`;
  },
  /** Primärfarben (abgestimmt mit index.css) */
  colors: {
    navy: '#0B1F3A',
    navyDeep: '#061525',
    accent: '#1B6CA8',
    accentLight: '#E8F1F8',
    accentForeground: '#0B1F3A',
  },
  /** Platzhalter-Hinweis für Admin-Logo-Upload */
  logoUploadHint:
    'Laden Sie hier das offizielle Logo von Hubcom - Citadelle AG hoch. Bis dahin wird das Platzhalter-SVG verwendet.',
} as const;

export type BrandConfig = typeof brandConfig;

/** Aktives Firmenlogo: hochgeladenes Asset oder null (Platzhalter-SVG rendern). */
export function getCustomLogoUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = localStorage.getItem(BRAND_STORAGE_KEYS.logoUrl);
    return url && url.trim() ? url.trim() : null;
  } catch {
    return null;
  }
}

export function setCustomLogoUrl(dataUrlOrPath: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!dataUrlOrPath) {
      localStorage.removeItem(BRAND_STORAGE_KEYS.logoUrl);
    } else {
      localStorage.setItem(BRAND_STORAGE_KEYS.logoUrl, dataUrlOrPath);
    }
    window.dispatchEvent(new CustomEvent('hubcom-brand-logo-changed'));
  } catch {
    /* ignore quota / private mode */
  }
}

export function getDisplayCompanyName(): string {
  if (typeof window === 'undefined') return brandConfig.companyName;
  try {
    return localStorage.getItem(BRAND_STORAGE_KEYS.companyName)?.trim() || brandConfig.companyName;
  } catch {
    return brandConfig.companyName;
  }
}
