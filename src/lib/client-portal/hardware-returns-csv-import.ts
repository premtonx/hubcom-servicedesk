/**
 * SharePoint Returns CSV import — preview + commit (Part 2/3).
 * Uses Part 1 pure parser; writes only ticket_hardware_returns (+ optional catalogs/directory).
 * Never creates normal tickets (ticket_id always NULL).
 */

import { randomUUID } from 'crypto';
import { queryDb, withPgTransaction } from '../postgres-backend.js';
import { getOrganization, updateOrganizationHardwareModule } from './organizations.js';
import {
  formatReturnNumber,
  insertStandaloneHardwareReturn,
  normalizeHardwareReturnsConfig,
  resolveHardwareReturnIdPrefix,
  type HardwareReturnsCatalogs,
  type TicketHardwareReturnInput,
} from './hardware-returns.js';
import {
  parseSharePointReturnsCsv,
  type DiscoveredCatalogs,
  type ParsedSharePointReturnRow,
} from './hardware-returns-csv-parser.js';

export type ImportCsvScope = 'all' | 'open_only';

export type SharePointImportPreviewRow = ParsedSharePointReturnRow & {
  duplicate: boolean;
  willImport: boolean;
  skipReason: 'test' | 'duplicate' | 'completed_out_of_scope' | 'missing_id' | null;
};

export type SharePointImportPreviewSummary = {
  total: number;
  toImport: number;
  openCount: number;
  completedCount: number;
  testExcluded: number;
  duplicatesSkipped: number;
  employeesDetected: number;
  newCatalogItems: DiscoveredCatalogs;
};

export type SharePointImportPreviewResult = {
  summary: SharePointImportPreviewSummary;
  previewRows: SharePointImportPreviewRow[];
  errors: string[];
};

export type SharePointImportCommitResult = {
  imported: number;
  skipped: number;
  testExcluded: number;
  employeesSeeded: number;
  addedCatalogItems: DiscoveredCatalogs;
  nextSequenceNumber: number;
  errors: string[];
};

const IMPORT_CHUNK = 40;

function emptyCatalogs(): DiscoveredCatalogs {
  return {
    device_types: [],
    shipping_methods: [],
    statuses: [],
    slas: [],
    service_levels: [],
  };
}

function looksLikeSerialCatalogValue(value: string): boolean {
  const t = String(value || '').trim();
  if (!t || /\s/.test(t)) return false;
  if (/^(DPG-[A-Z0-9-]+|BCST\d+)$/i.test(t)) return true;
  if (/^[A-Z]{2}\d{4,}$/i.test(t)) return true;
  if (/^\d{4}$/.test(t)) return true;
  return false;
}

/** Merge incoming catalog values into existing without removing admin items. */
export function mergeCatalogLists(
  existing: string[] | undefined,
  incoming: string[] | undefined,
): { merged: string[]; added: string[] } {
  const base = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(base.map((x) => x.trim().toLowerCase()).filter(Boolean));
  const added: string[] = [];
  for (const raw of incoming || []) {
    const item = String(raw || '').trim();
    if (!item || item.length > 200) continue;
    if (looksLikeSerialCatalogValue(item)) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    base.push(item);
    added.push(item);
  }
  return { merged: base.slice(0, 100), added };
}

export function diffNewCatalogItems(
  discovered: DiscoveredCatalogs,
  current: HardwareReturnsCatalogs,
): DiscoveredCatalogs {
  const diffOne = (incoming: string[], existing: string[]) =>
    mergeCatalogLists(existing, incoming).added;
  return {
    device_types: diffOne(discovered.device_types, current.device_types),
    shipping_methods: diffOne(
      [...discovered.shipping_methods, 'Kein Versand'],
      current.shipping_methods,
    ),
    statuses: diffOne(discovered.statuses, current.statuses),
    slas: diffOne(discovered.slas, current.slas),
    service_levels: diffOne(discovered.service_levels, current.service_levels),
  };
}

export function countUniqueEmployees(rows: ParsedSharePointReturnRow[]): number {
  const keys = new Set<string>();
  for (const row of rows) {
    const email = String(row.employeeEmail || '')
      .trim()
      .toLowerCase();
    const name = String(row.employeeName || '')
      .trim()
      .toLowerCase();
    if (!email && !name) continue;
    keys.add(email || `name:${name}`);
  }
  return keys.size;
}

export function planSharePointImportRows(params: {
  rows: ParsedSharePointReturnRow[];
  existingExternalRefIds: Set<string>;
  scope: ImportCsvScope;
  excludeTestRows: boolean;
}): SharePointImportPreviewRow[] {
  const { rows, existingExternalRefIds, scope, excludeTestRows } = params;
  return rows.map((row) => {
    const ref = String(row.externalRefId || '').trim();
    const duplicate = Boolean(ref) && existingExternalRefIds.has(ref);
    let skipReason: SharePointImportPreviewRow['skipReason'] = null;
    if (!ref) skipReason = 'missing_id';
    else if (excludeTestRows && row.isLikelyTest) skipReason = 'test';
    else if (duplicate) skipReason = 'duplicate';
    else if (scope === 'open_only' && row.returned) skipReason = 'completed_out_of_scope';

    return {
      ...row,
      duplicate,
      willImport: skipReason === null,
      skipReason,
    };
  });
}

/** Map parser row → TicketHardwareReturnInput (no Betreff / legacy junk columns). */
export function mapParsedRowToHardwareInput(
  row: ParsedSharePointReturnRow,
  opts: {
    prefix: string;
    enableAutoReminders: boolean;
    actorName?: string | null;
  },
): TicketHardwareReturnInput {
  const numeric = row.externalRefNumeric;
  const returnNumber =
    numeric != null
      ? formatReturnNumber(opts.prefix, numeric)
      : row.externalRefId
        ? formatReturnNumber(opts.prefix, Number(String(row.externalRefId).replace(/\D/g, '')) || 1)
        : undefined;

  const now = new Date().toISOString();
  return {
    ticket_id: null,
    external_ref_id: row.externalRefId,
    return_number: returnNumber,
    subject: null,
    employee_name: row.employeeName,
    employee_email: row.employeeEmail,
    employee_phone: row.phoneOffice,
    employee_mobile: row.phoneMobile,
    assignee_name: row.assigneeName,
    status: row.status || (row.returned ? 'Geschlossen' : 'Neu'),
    sla: row.sla || 'Normal',
    service_level: row.serviceLevel,
    shipping_method: row.shippingMethod,
    shipping_reference: row.shippingReference,
    time_sl1_minutes: row.timeSl1Minutes,
    time_sl2_minutes: row.timeSl2Minutes,
    time_sl3_minutes: row.timeSl3Minutes,
    exported: row.exported,
    exported_at: row.exported ? row.createdAt || now : null,
    device_old_type: row.deviceOldType,
    device_old_serial: row.deviceOldSerial,
    device_new_type: row.deviceNewType,
    device_new_serial: row.deviceNewSerial,
    device_details: row.legacyGeraetetyp,
    description: row.description,
    return_required: row.returnRequired,
    returned: row.returned,
    returned_at: row.returnedAt,
    delivery_date: row.deliveryDate,
    return_due_date: row.returnDueDate,
    auto_reminder_enabled: Boolean(opts.enableAutoReminders),
    mail1_sent_at: row.mail1SentAt,
    mail2_sent_at: row.mail2SentAt,
    mail3_sent_at: row.mail3SentAt,
    activity_log: [
      {
        at: now,
        type: 'imported',
        actor: opts.actorName || 'import',
        message: 'Aus SharePoint CSV importiert',
        meta: { external_ref_id: row.externalRefId },
      },
    ],
  };
}

async function loadExistingExternalRefIds(organizationId: string): Promise<Set<string>> {
  const res = await queryDb(
    `SELECT external_ref_id
     FROM ticket_hardware_returns
     WHERE organization_id = $1
       AND external_ref_id IS NOT NULL
       AND TRIM(external_ref_id) <> ''`,
    [organizationId],
  );
  const set = new Set<string>();
  for (const row of res.rows) {
    const id = String(row.external_ref_id || '').trim();
    if (id) set.add(id);
  }
  return set;
}

export async function previewSharePointReturnsImport(params: {
  organizationId: string;
  csvText: string;
  scope?: ImportCsvScope;
  excludeTestRows?: boolean;
}): Promise<SharePointImportPreviewResult> {
  const org = await getOrganization(params.organizationId);
  if (!org?.hardware_returns_enabled) {
    throw Object.assign(new Error('Hardware-Rücklieferungen nicht aktiv.'), { status: 403 });
  }

  const scope: ImportCsvScope = params.scope === 'open_only' ? 'open_only' : 'all';
  const excludeTestRows = params.excludeTestRows !== false;

  const parsed = parseSharePointReturnsCsv(params.csvText, { includeTestRows: true });
  const existing = await loadExistingExternalRefIds(params.organizationId);
  const previewRows = planSharePointImportRows({
    rows: parsed.rows,
    existingExternalRefIds: existing,
    scope,
    excludeTestRows,
  });

  const toImportRows = previewRows.filter((r) => r.willImport);
  const openCount = parsed.rows.filter((r) => !r.returned).length;
  const completedCount = parsed.rows.filter((r) => r.returned).length;
  const testExcluded = previewRows.filter((r) => r.skipReason === 'test').length;
  const duplicatesSkipped = previewRows.filter((r) => r.skipReason === 'duplicate').length;

  const config = normalizeHardwareReturnsConfig(org.hardware_returns_config);
  const newCatalogItems = diffNewCatalogItems(parsed.discoveredCatalogs, config.catalogs);

  return {
    summary: {
      total: parsed.rows.length,
      toImport: toImportRows.length,
      openCount,
      completedCount,
      testExcluded,
      duplicatesSkipped,
      employeesDetected: countUniqueEmployees(toImportRows),
      newCatalogItems,
    },
    previewRows,
    errors: parsed.errors,
  };
}

async function seedCsvDirectoryUsers(params: {
  organizationId: string;
  rows: ParsedSharePointReturnRow[];
}): Promise<number> {
  const unique = new Map<
    string,
    { name: string; email: string; phoneOffice: string | null; phoneMobile: string | null }
  >();
  for (const row of params.rows) {
    const email = String(row.employeeEmail || '')
      .trim()
      .toLowerCase();
    if (!email || !email.includes('@')) continue;
    if (!unique.has(email)) {
      unique.set(email, {
        name: String(row.employeeName || email).trim() || email,
        email,
        phoneOffice: row.phoneOffice,
        phoneMobile: row.phoneMobile,
      });
    }
  }

  let seeded = 0;
  const now = new Date().toISOString();
  await withPgTransaction(async (client) => {
    for (const emp of unique.values()) {
      const entraId = `csv:${emp.email}`.slice(0, 80);
      // Never overwrite Graph-synced directory rows for the same email.
      const existing = await client.query(
        `SELECT entra_object_id FROM organization_directory_users
         WHERE organization_id = $1
           AND LOWER(email) = $2
         LIMIT 1`,
        [params.organizationId, emp.email],
      );
      if (existing.rowCount) {
        const oid = String(existing.rows[0].entra_object_id || '');
        if (!oid.startsWith('csv:')) continue;
      }

      await client.query(
        `INSERT INTO organization_directory_users (
           id, organization_id, entra_object_id, display_name, email, user_principal_name,
           phone_office, phone_mobile, manager_name, manager_email, department, job_title,
           is_active, last_synced_at, created_at, updated_at
         ) VALUES (
           $1::uuid, $2, $3, $4, $5, $5,
           $6, $7, NULL, NULL, NULL, NULL,
           TRUE, $8::timestamptz, NOW(), NOW()
         )
         ON CONFLICT (organization_id, entra_object_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           phone_office = COALESCE(EXCLUDED.phone_office, organization_directory_users.phone_office),
           phone_mobile = COALESCE(EXCLUDED.phone_mobile, organization_directory_users.phone_mobile),
           is_active = TRUE,
           last_synced_at = EXCLUDED.last_synced_at,
           updated_at = NOW()
         WHERE organization_directory_users.entra_object_id LIKE 'csv:%'`,
        [
          randomUUID(),
          params.organizationId,
          entraId,
          emp.name.slice(0, 255),
          emp.email.slice(0, 320),
          emp.phoneOffice,
          emp.phoneMobile,
          now,
        ],
      );
      seeded += 1;
    }
  });
  return seeded;
}

async function bumpHardwareReturnsSeq(
  organizationId: string,
  maxNumericId: number,
): Promise<number> {
  if (!Number.isFinite(maxNumericId) || maxNumericId < 1) {
    const cur = await queryDb(
      `SELECT hardware_returns_seq FROM organizations WHERE id = $1 LIMIT 1`,
      [organizationId],
    );
    return Number(cur.rows[0]?.hardware_returns_seq) || 0;
  }
  const res = await queryDb(
    `UPDATE organizations
     SET hardware_returns_seq = GREATEST(hardware_returns_seq, $2),
         updated_at = NOW()
     WHERE id = $1
     RETURNING hardware_returns_seq`,
    [organizationId, Math.floor(maxNumericId)],
  );
  return Number(res.rows[0]?.hardware_returns_seq) || Math.floor(maxNumericId);
}

export async function commitSharePointReturnsImport(params: {
  organizationId: string;
  csvText: string;
  scope?: ImportCsvScope;
  excludeTestRows?: boolean;
  mergeCatalogs?: boolean;
  seedDirectory?: boolean;
  enableAutoReminders?: boolean;
  actorId?: string | null;
  actorName?: string | null;
}): Promise<SharePointImportCommitResult> {
  const org = await getOrganization(params.organizationId);
  if (!org?.hardware_returns_enabled) {
    throw Object.assign(new Error('Hardware-Rücklieferungen nicht aktiv.'), { status: 403 });
  }

  const scope: ImportCsvScope = params.scope === 'open_only' ? 'open_only' : 'all';
  const excludeTestRows = params.excludeTestRows !== false;
  const enableAutoReminders = Boolean(params.enableAutoReminders);
  const mergeCatalogs = Boolean(params.mergeCatalogs);
  const seedDirectory = Boolean(params.seedDirectory);

  const parsed = parseSharePointReturnsCsv(params.csvText, { includeTestRows: true });
  const existing = await loadExistingExternalRefIds(params.organizationId);
  const planned = planSharePointImportRows({
    rows: parsed.rows,
    existingExternalRefIds: existing,
    scope,
    excludeTestRows,
  });

  const toImport = planned.filter((r) => r.willImport);
  const testExcluded = planned.filter((r) => r.skipReason === 'test').length;
  const skipped = planned.length - toImport.length;
  const errors: string[] = [...parsed.errors];

  const config = normalizeHardwareReturnsConfig(org.hardware_returns_config);
  const prefix = resolveHardwareReturnIdPrefix({
    config,
    organizationName: org.name,
  });

  let imported = 0;
  let maxNumeric = 0;
  const importedEmployees: ParsedSharePointReturnRow[] = [];

  for (let i = 0; i < toImport.length; i += IMPORT_CHUNK) {
    const chunk = toImport.slice(i, i + IMPORT_CHUNK);
    for (const row of chunk) {
      try {
        // Re-check duplicate inside loop (race-safe enough for import UI).
        if (row.externalRefId && existing.has(row.externalRefId)) {
          continue;
        }
        const input = mapParsedRowToHardwareInput(row, {
          prefix,
          enableAutoReminders,
          actorName: params.actorName,
        });
        const hw = await insertStandaloneHardwareReturn({
          organizationId: params.organizationId,
          actorName: params.actorName || 'CSV-Import',
          actorId: params.actorId || null,
          mail1Days: config.mail1_days_after_delivery,
          input,
        });

        // Stamp mail sent / created_at (insert path does not set mail*_sent_at).
        await queryDb(
          `UPDATE ticket_hardware_returns SET
             mail1_sent_at = $2::timestamptz,
             mail2_sent_at = $3::timestamptz,
             mail3_sent_at = $4::timestamptz,
             created_at = COALESCE($5::timestamptz, created_at),
             auto_reminder_enabled = $6,
             updated_at = NOW()
           WHERE id = $1::uuid`,
          [
            hw.id,
            row.mail1SentAt,
            row.mail2SentAt,
            row.mail3SentAt,
            row.createdAt,
            enableAutoReminders,
          ],
        );

        if (row.externalRefId) existing.add(row.externalRefId);
        if (row.externalRefNumeric != null && row.externalRefNumeric > maxNumeric) {
          maxNumeric = row.externalRefNumeric;
        }
        importedEmployees.push(row);
        imported += 1;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`ID ${row.externalRefId || row.rowIndex}: ${message}`);
      }
    }
  }

  const nextSequenceNumber = await bumpHardwareReturnsSeq(params.organizationId, maxNumeric);

  let addedCatalogItems = emptyCatalogs();
  if (mergeCatalogs) {
    const catalogs = config.catalogs;
    const device = mergeCatalogLists(catalogs.device_types, parsed.discoveredCatalogs.device_types);
    const shipping = mergeCatalogLists(catalogs.shipping_methods, [
      ...parsed.discoveredCatalogs.shipping_methods,
      'Kein Versand',
    ]);
    const statuses = mergeCatalogLists(catalogs.statuses, parsed.discoveredCatalogs.statuses);
    const slas = mergeCatalogLists(catalogs.slas, parsed.discoveredCatalogs.slas);
    const serviceLevels = mergeCatalogLists(
      catalogs.service_levels,
      parsed.discoveredCatalogs.service_levels,
    );
    addedCatalogItems = {
      device_types: device.added,
      shipping_methods: shipping.added,
      statuses: statuses.added,
      slas: slas.added,
      service_levels: serviceLevels.added,
    };
    const hasAdds = Object.values(addedCatalogItems).some((arr) => arr.length > 0);
    if (hasAdds) {
      await updateOrganizationHardwareModule(params.organizationId, {
        hardware_returns_config: {
          ...config,
          catalogs: {
            device_types: device.merged,
            shipping_methods: shipping.merged,
            statuses: statuses.merged,
            slas: slas.merged,
            service_levels: serviceLevels.merged,
          },
        },
      });
    }
  }

  let employeesSeeded = 0;
  if (seedDirectory && importedEmployees.length) {
    employeesSeeded = await seedCsvDirectoryUsers({
      organizationId: params.organizationId,
      rows: importedEmployees,
    });
  }

  return {
    imported,
    skipped,
    testExcluded,
    employeesSeeded,
    addedCatalogItems,
    nextSequenceNumber,
    errors: errors.slice(0, 50),
  };
}
