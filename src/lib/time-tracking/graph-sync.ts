/**
 * Microsoft Graph Excel-Sync für Zeiteinträge.
 * Authentifizierung: OAuth2 Client Credentials.
 * Upsert über Spalte „Entry-ID“, damit keine Duplikate entstehen.
 */
import axios from 'axios';
import { acquireGraphToken } from '../kb/ms-graph.js';
import { safeErrorMessage } from '../safe-log.js';
import { loadTimeTrackingSettings } from './settings.js';
import { listAllTimeEntries, markEntriesGraphSynced } from './store.js';
import type { TimeEntry, TimeTrackingSettings } from './types.js';
import { entryToRow } from './excel-export.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface GraphSyncResult {
  ok: boolean;
  added: number;
  updated: number;
  skipped: number;
  message: string;
}

async function resolveWorkbookItemId(
  token: string,
  settings: TimeTrackingSettings,
): Promise<{ driveId: string; itemId: string }> {
  const graph = settings.graph;
  let driveId = graph.driveId.trim();

  if (!driveId && graph.siteId.trim()) {
    const siteRes = await axios.get<{ id?: string }>(
      `${GRAPH}/sites/${encodeURIComponent(graph.siteId.trim())}/drive`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 30_000 },
    );
    driveId = String(siteRes.data?.id || '');
  }

  if (!driveId) {
    throw new Error('Microsoft Graph: Drive-ID oder Site-ID ist erforderlich.');
  }

  const pathOrId = graph.workbookPathOrId.trim();
  if (!pathOrId) {
    throw new Error('Microsoft Graph: Dateipfad oder Workbook-ID ist erforderlich.');
  }

  // Item-ID (GUID-ähnlich) direkt verwenden
  if (!pathOrId.includes('/') && !pathOrId.includes('.')) {
    return { driveId, itemId: pathOrId };
  }

  const cleanPath = pathOrId.replace(/^\/+/, '');
  const itemRes = await axios.get<{ id?: string }>(
    `${GRAPH}/drives/${encodeURIComponent(driveId)}/root:/${cleanPath}`,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 30_000 },
  );
  const itemId = String(itemRes.data?.id || '');
  if (!itemId) {
    throw new Error(`Workbook nicht gefunden: ${cleanPath}`);
  }
  return { driveId, itemId };
}

async function ensureTable(
  token: string,
  driveId: string,
  itemId: string,
  tableName: string,
  worksheetName: string,
): Promise<string> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    const tables = await axios.get<{ value?: Array<{ id?: string; name?: string }> }>(
      `${GRAPH}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/workbook/tables`,
      { headers, timeout: 30_000 },
    );
    const match = (tables.data?.value || []).find(
      (t) => String(t.name || '').toLowerCase() === tableName.toLowerCase(),
    );
    if (match?.id || match?.name) {
      return String(match.name || match.id);
    }
  } catch {
    /* create below */
  }

  // Tabelle anlegen (A1:L1 Header)
  await axios.post(
    `${GRAPH}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/workbook/worksheets/${encodeURIComponent(worksheetName)}/tables/add`,
    {
      address: 'A1:L1',
      hasHeaders: true,
    },
    { headers, timeout: 30_000 },
  );

  // Header-Werte setzen
  await axios.patch(
    `${GRAPH}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/workbook/worksheets/${encodeURIComponent(worksheetName)}/range(address='A1:L1')`,
    {
      values: [[
        'Ticket-Nr.',
        'Betreff',
        'Kunde',
        'Datum',
        'Mitarbeiter',
        'Kürzel',
        'Stunden',
        'Sonderzahlung',
        'Stundensatz (€)',
        'Gesamtbetrag (€)',
        'Beschreibung',
        'Entry-ID',
      ]],
    },
    { headers, timeout: 30_000 },
  );

  return tableName;
}

async function loadExistingEntryIdMap(
  token: string,
  driveId: string,
  itemId: string,
  tableName: string,
): Promise<Map<string, number>> {
  const headers = { Authorization: `Bearer ${token}` };
  const map = new Map<string, number>();
  try {
    const res = await axios.get<{
      value?: Array<{ values?: unknown[][]; index?: number }>;
    }>(
      `${GRAPH}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/workbook/tables/${encodeURIComponent(tableName)}/rows`,
      { headers, timeout: 60_000 },
    );
    const rows = res.data?.value || [];
    rows.forEach((row, idx) => {
      const values = row.values?.[0] || [];
      // Entry-ID = letzte Spalte (Index 11)
      const entryId = String(values[11] ?? '').trim();
      if (entryId) {
        map.set(entryId, typeof row.index === 'number' ? row.index : idx);
      }
    });
  } catch (err) {
    console.warn('[time-graph-sync] Konnte bestehende Tabellenzeilen nicht lesen:', safeErrorMessage(err));
  }
  return map;
}

async function upsertEntryRow(params: {
  token: string;
  driveId: string;
  itemId: string;
  tableName: string;
  entry: TimeEntry;
  existingIndex: number | undefined;
}): Promise<'added' | 'updated'> {
  const headers = {
    Authorization: `Bearer ${params.token}`,
    'Content-Type': 'application/json',
  };
  const values = [entryToRow(params.entry)];

  if (params.existingIndex !== undefined) {
    await axios.patch(
      `${GRAPH}/drives/${encodeURIComponent(params.driveId)}/items/${encodeURIComponent(params.itemId)}/workbook/tables/${encodeURIComponent(params.tableName)}/rows/itemAt(index=${params.existingIndex})`,
      { values },
      { headers, timeout: 30_000 },
    );
    return 'updated';
  }

  await axios.post(
    `${GRAPH}/drives/${encodeURIComponent(params.driveId)}/items/${encodeURIComponent(params.itemId)}/workbook/tables/${encodeURIComponent(params.tableName)}/rows/add`,
    { values },
    { headers, timeout: 30_000 },
  );
  return 'added';
}

export async function syncTimeEntriesToGraph(options?: {
  onlyUnsynced?: boolean;
}): Promise<GraphSyncResult> {
  const settings = await loadTimeTrackingSettings();
  if (!settings.graph.enabled) {
    return {
      ok: false,
      added: 0,
      updated: 0,
      skipped: 0,
      message: 'Microsoft Graph Excel-Sync ist deaktiviert.',
    };
  }
  if (!settings.graph.tenantId || !settings.graph.clientId || !settings.graph.clientSecret) {
    return {
      ok: false,
      added: 0,
      updated: 0,
      skipped: 0,
      message: 'Graph-Zugangsdaten unvollständig (Tenant ID, Client ID, Client Secret).',
    };
  }

  const token = await acquireGraphToken({
    clientId: settings.graph.clientId,
    azureTenantId: settings.graph.tenantId,
    clientSecret: settings.graph.clientSecret,
  });

  const { driveId, itemId } = await resolveWorkbookItemId(token, settings);
  const tableName = await ensureTable(
    token,
    driveId,
    itemId,
    settings.graph.tableName,
    settings.graph.worksheetName,
  );
  const existing = await loadExistingEntryIdMap(token, driveId, itemId, tableName);

  let entries = await listAllTimeEntries();
  if (options?.onlyUnsynced) {
    entries = entries.filter((e) => !e.graphSyncedAt);
  }

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const syncedIds: string[] = [];

  for (const entry of entries) {
    try {
      const result = await upsertEntryRow({
        token,
        driveId,
        itemId,
        tableName,
        entry,
        existingIndex: existing.get(entry.id),
      });
      if (result === 'added') added += 1;
      else updated += 1;
      syncedIds.push(entry.id);
    } catch (err) {
      skipped += 1;
      console.warn(`[time-graph-sync] Eintrag ${entry.id} fehlgeschlagen:`, safeErrorMessage(err));
    }
  }

  if (syncedIds.length > 0) {
    await markEntriesGraphSynced(syncedIds);
  }

  return {
    ok: skipped === 0,
    added,
    updated,
    skipped,
    message: `Graph-Sync abgeschlossen: ${added} neu, ${updated} aktualisiert, ${skipped} übersprungen.`,
  };
}
