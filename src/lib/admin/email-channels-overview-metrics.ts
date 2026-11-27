/**
 * Derive E-Mail-Kanäle Übersicht KPIs + activity from real channel records.
 * Never invent processed-mail counts or response times when data is absent.
 */

export type EmailChannelMetricRow = {
  id: string;
  name?: string | null;
  displayName?: string | null;
  email?: string | null;
  enabled?: boolean;
  status?: string | null;
  connectionType?: string | null;
  lastTestOk?: boolean | null;
  lastTestAt?: string | null;
  lastPolledAt?: string | null;
  lastError?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  isPrimary?: boolean;
};

export type EmailChannelsKpis = {
  activeChannels: number;
  totalChannels: number;
  /** null → UI shows "—" (no processed-mail ledger yet). */
  processedEmails: number | null;
  /** null → UI shows "—" when no tests recorded. */
  successRatePercent: number | null;
  /** null → UI shows "—". */
  avgResponseTimeLabel: string | null;
  recentlyAdded: number;
};

export type EmailChannelActivity = {
  id: string;
  channelId: string;
  channelName: string;
  kind: 'test_ok' | 'test_fail' | 'poll' | 'error' | 'created' | 'updated';
  label: string;
  at: string;
};

function isActiveChannel(c: EmailChannelMetricRow): boolean {
  return c.enabled !== false && String(c.status || '') !== 'disabled';
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function computeEmailChannelsKpis(
  channels: EmailChannelMetricRow[],
  opts?: { recentDays?: number },
): EmailChannelsKpis {
  const recentDays = opts?.recentDays ?? 7;
  const cutoff = daysAgoIso(recentDays);
  const active = channels.filter(isActiveChannel);
  const tested = channels.filter((c) => c.lastTestOk === true || c.lastTestOk === false);
  const ok = tested.filter((c) => c.lastTestOk === true).length;
  const recentlyAdded = channels.filter(
    (c) => c.createdAt && String(c.createdAt) >= cutoff,
  ).length;

  return {
    activeChannels: active.length,
    totalChannels: channels.length,
    processedEmails: null,
    successRatePercent:
      tested.length === 0 ? null : Math.round((ok / tested.length) * 1000) / 10,
    avgResponseTimeLabel: null,
    recentlyAdded,
  };
}

export function buildEmailChannelActivities(
  channels: EmailChannelMetricRow[],
  limit = 12,
): EmailChannelActivity[] {
  const events: EmailChannelActivity[] = [];
  for (const c of channels) {
    const channelName =
      String(c.displayName || c.name || c.email || c.id || 'Kanal').trim() || 'Kanal';
    if (c.lastTestAt) {
      events.push({
        id: `${c.id}-test`,
        channelId: c.id,
        channelName,
        kind: c.lastTestOk === false ? 'test_fail' : 'test_ok',
        label:
          c.lastTestOk === false
            ? `Verbindungstest fehlgeschlagen${c.lastError ? `: ${c.lastError}` : ''}`
            : 'Verbindungstest erfolgreich',
        at: String(c.lastTestAt),
      });
    }
    if (c.lastPolledAt) {
      events.push({
        id: `${c.id}-poll`,
        channelId: c.id,
        channelName,
        kind: 'poll',
        label: 'Postfach abgefragt',
        at: String(c.lastPolledAt),
      });
    }
    if (c.lastError && !c.lastTestAt) {
      events.push({
        id: `${c.id}-err`,
        channelId: c.id,
        channelName,
        kind: 'error',
        label: c.lastError,
        at: String(c.updatedAt || c.createdAt || new Date().toISOString()),
      });
    }
    if (c.createdAt) {
      events.push({
        id: `${c.id}-created`,
        channelId: c.id,
        channelName,
        kind: 'created',
        label: 'Kanal angelegt',
        at: String(c.createdAt),
      });
    }
  }
  return events
    .filter((e) => e.at && !Number.isNaN(Date.parse(e.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
}

/** German relative timestamp (vor X Min. / vor X Std. / vor X Tg.). */
export function formatRelativeTimeDe(iso: string, nowMs = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const diffSec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (diffSec < 60) return 'gerade eben';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return `vor ${days} Tg.`;
}

export function connectionTypeLabelDe(type: string | null | undefined): string {
  switch (String(type || '')) {
    case 'webhook':
      return 'E-Mail-Weiterleitung';
    case 'imap_basic':
      return 'IMAP';
    case 'imap_oauth2':
      return 'IMAP OAuth2';
    case 'microsoft_graph':
      return 'Microsoft 365';
    default:
      return type ? String(type) : 'Kanal';
  }
}

export function channelStatusLabelDe(channel: EmailChannelMetricRow): {
  label: string;
  active: boolean;
} {
  if (!isActiveChannel(channel)) {
    return { label: 'Inaktiv', active: false };
  }
  const s = String(channel.status || '').toLowerCase();
  if (s === 'auth_error' || s === 'failed') return { label: 'Fehler', active: true };
  if (s === 'pending') return { label: 'Ausstehend', active: true };
  return { label: 'Aktiv', active: true };
}
