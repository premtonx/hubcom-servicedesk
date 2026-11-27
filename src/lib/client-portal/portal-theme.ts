/**
 * Per-organization Client Portal theme (3 brand colors + light/dark mode).
 * Persisted under organizations.settings.portal_theme (FORCE RLS via organizations).
 */

export const PORTAL_DEFAULT_PRIMARY = '#2563EB';
export const PORTAL_DEFAULT_SECONDARY = '#0EA5E9';
export const PORTAL_CONTRAST_LIGHT = '#FFFFFF';
export const PORTAL_CONTRAST_DARK = '#0F172A';

export type PortalThemeMode = 'light' | 'dark' | 'system';

export interface PortalThemeSettings {
  primaryColor: string;
  secondaryColor: string;
  /** null → adaptive Light/Dark sidebar surface */
  sidebarColor: string | null;
  themeMode: PortalThemeMode;
  allowUserThemeToggle: boolean;
}

export const DEFAULT_PORTAL_THEME: PortalThemeSettings = {
  primaryColor: PORTAL_DEFAULT_PRIMARY,
  secondaryColor: PORTAL_DEFAULT_SECONDARY,
  sidebarColor: null,
  themeMode: 'light',
  allowUserThemeToggle: true,
};

const HEX_RE = /^#([0-9A-Fa-f]{6})$/;

export function isValidPortalHex(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

export function normalizePortalHex(value: unknown, fallback: string): string {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  if (HEX_RE.test(withHash)) return withHash.toUpperCase();
  // Expand #RGB
  const short = /^#([0-9A-Fa-f]{3})$/.exec(withHash);
  if (short) {
    const [r, g, b] = short[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

export function normalizeOptionalPortalHex(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = normalizePortalHex(value, '');
  return normalized || null;
}

export function normalizePortalThemeMode(value: unknown): PortalThemeMode {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'dark' || v === 'system' || v === 'light') return v;
  return 'light';
}

/** Relative luminance (sRGB) → pick white or near-black foreground. */
export function contrastForeground(hex: string): string {
  const normalized = normalizePortalHex(hex, PORTAL_DEFAULT_PRIMARY);
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const toLin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const L = 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
  return L > 0.45 ? PORTAL_CONTRAST_DARK : PORTAL_CONTRAST_LIGHT;
}

function readThemeBlob(settings: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!settings || typeof settings !== 'object') return {};
  const nested = settings.portal_theme;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  // Flat fallback keys (older drafts / partial patches)
  return {
    primaryColor: settings.primaryColor ?? settings.portal_primary_color,
    secondaryColor: settings.secondaryColor ?? settings.portal_secondary_color,
    sidebarColor: settings.sidebarColor ?? settings.portal_sidebar_color,
    themeMode: settings.themeMode ?? settings.portal_theme_mode,
    allowUserThemeToggle:
      settings.allowUserThemeToggle ?? settings.portal_allow_user_theme_toggle,
  };
}

export function normalizePortalThemeSettings(
  settings: Record<string, unknown> | null | undefined,
): PortalThemeSettings {
  const blob = readThemeBlob(settings);
  const allowRaw = blob.allowUserThemeToggle;
  return {
    primaryColor: normalizePortalHex(blob.primaryColor, PORTAL_DEFAULT_PRIMARY),
    secondaryColor: normalizePortalHex(blob.secondaryColor, PORTAL_DEFAULT_SECONDARY),
    sidebarColor: normalizeOptionalPortalHex(blob.sidebarColor),
    themeMode: normalizePortalThemeMode(blob.themeMode),
    allowUserThemeToggle:
      allowRaw === undefined || allowRaw === null ? true : Boolean(allowRaw),
  };
}

export function portalThemeFromOrganization(org: {
  settings?: Record<string, unknown> | null;
}): PortalThemeSettings {
  return normalizePortalThemeSettings(org.settings || {});
}

/** Merge a partial theme patch into organizations.settings (immutable). */
export function mergePortalThemeIntoSettings(
  existingSettings: Record<string, unknown> | null | undefined,
  patch: Partial<PortalThemeSettings>,
): Record<string, unknown> {
  const current = normalizePortalThemeSettings(existingSettings);
  const next: PortalThemeSettings = {
    primaryColor:
      patch.primaryColor !== undefined
        ? normalizePortalHex(patch.primaryColor, PORTAL_DEFAULT_PRIMARY)
        : current.primaryColor,
    secondaryColor:
      patch.secondaryColor !== undefined
        ? normalizePortalHex(patch.secondaryColor, PORTAL_DEFAULT_SECONDARY)
        : current.secondaryColor,
    sidebarColor:
      patch.sidebarColor !== undefined
        ? normalizeOptionalPortalHex(patch.sidebarColor)
        : current.sidebarColor,
    themeMode:
      patch.themeMode !== undefined
        ? normalizePortalThemeMode(patch.themeMode)
        : current.themeMode,
    allowUserThemeToggle:
      patch.allowUserThemeToggle !== undefined
        ? Boolean(patch.allowUserThemeToggle)
        : current.allowUserThemeToggle,
  };
  return {
    ...(existingSettings && typeof existingSettings === 'object' ? existingSettings : {}),
    portal_theme: next,
  };
}

export function parsePortalThemePatch(body: unknown): {
  ok: true;
  patch: Partial<PortalThemeSettings>;
} | { ok: false; error: string } {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: true, patch: {} };
  }
  const raw = body as Record<string, unknown>;
  const patch: Partial<PortalThemeSettings> = {};

  if (raw.primaryColor !== undefined) {
    const hex = normalizePortalHex(raw.primaryColor, '');
    if (!hex) return { ok: false, error: 'primaryColor muss ein Hex-Wert sein (#RRGGBB).' };
    patch.primaryColor = hex;
  }
  if (raw.secondaryColor !== undefined) {
    const hex = normalizePortalHex(raw.secondaryColor, '');
    if (!hex) return { ok: false, error: 'secondaryColor muss ein Hex-Wert sein (#RRGGBB).' };
    patch.secondaryColor = hex;
  }
  if (raw.sidebarColor !== undefined) {
    if (raw.sidebarColor === null || raw.sidebarColor === '') {
      patch.sidebarColor = null;
    } else {
      const hex = normalizePortalHex(raw.sidebarColor, '');
      if (!hex) return { ok: false, error: 'sidebarColor muss ein Hex-Wert oder null sein.' };
      patch.sidebarColor = hex;
    }
  }
  if (raw.themeMode !== undefined) {
    const mode = String(raw.themeMode || '').toLowerCase();
    if (mode !== 'light' && mode !== 'dark' && mode !== 'system') {
      return { ok: false, error: 'themeMode muss light, dark oder system sein.' };
    }
    patch.themeMode = mode;
  }
  if (raw.allowUserThemeToggle !== undefined) {
    patch.allowUserThemeToggle = Boolean(raw.allowUserThemeToggle);
  }

  return { ok: true, patch };
}

export function portalThemeCssVars(theme: PortalThemeSettings, resolvedDark: boolean): Record<string, string> {
  const primary = theme.primaryColor;
  const secondary = theme.secondaryColor;
  const sidebarBg =
    theme.sidebarColor ||
    (resolvedDark ? '#111827' : '#FFFFFF');
  return {
    '--portal-primary': primary,
    '--portal-primary-foreground': contrastForeground(primary),
    '--portal-secondary': secondary,
    '--portal-sidebar-bg': sidebarBg,
    '--portal-sidebar-fg': contrastForeground(sidebarBg),
  };
}

export const PORTAL_THEME_STORAGE_PREFIX = 'hubcom-portal-theme-override:';

export function portalThemeStorageKey(organizationId: string): string {
  return `${PORTAL_THEME_STORAGE_PREFIX}${organizationId}`;
}
