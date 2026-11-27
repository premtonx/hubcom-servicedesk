/**
 * User-selectable ticket workspace layout: Klassisch vs Outlook / Split-Ansicht.
 * Persisted in localStorage so the preference survives navigation and reloads.
 */

export type TicketWorkspaceMode = 'classic' | 'outlook';

export const TICKET_WORKSPACE_MODE_KEY = 'hubcom_ticket_workspace_mode';

export function parseTicketWorkspaceMode(raw: unknown): TicketWorkspaceMode {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'outlook' || v === 'split' || v === 'outlook_split') return 'outlook';
  return 'classic';
}

export function readTicketWorkspaceMode(): TicketWorkspaceMode {
  if (typeof window === 'undefined') return 'classic';
  try {
    return parseTicketWorkspaceMode(localStorage.getItem(TICKET_WORKSPACE_MODE_KEY));
  } catch {
    return 'classic';
  }
}

export function writeTicketWorkspaceMode(mode: TicketWorkspaceMode): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TICKET_WORKSPACE_MODE_KEY, mode);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Sentinel organizationId for “Privat / Ohne Unternehmen” in Outlook Unternehmen filter. */
export const UNASSIGNED_ORG_FILTER_ID = '__unassigned__';
