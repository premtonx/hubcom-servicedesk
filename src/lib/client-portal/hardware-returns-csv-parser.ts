/**
 * Pure SharePoint / PowerApps Hardware-Rücklieferungen CSV parser.
 * No DB / routes / UI — maps Ticketsystem_DPG.csv (38 columns) into structured
 * objects aligned with ticket_hardware_returns fields (Part 1/3).
 */

import { parseCsvMatrix } from '../kb/sharepoint-csv-import.js';

export type ParsedDeviceFields = {
  deviceOldType: string | null;
  deviceOldSerial: string | null;
  deviceNewType: string | null;
  deviceNewSerial: string | null;
  extraNotes: string | null;
};

export type DiscoveredCatalogs = {
  device_types: string[];
  shipping_methods: string[];
  statuses: string[];
  slas: string[];
  service_levels: string[];
};

/** Structured row matching upcoming import mapping (camelCase ↔ DB fields). */
export type ParsedSharePointReturnRow = {
  rowIndex: number;
  externalRefId: string | null;
  externalRefNumeric: number | null;
  createdAt: string | null;
  deliveryDate: string | null;
  returnDueDate: string | null;
  assigneeName: string | null;
  employeeName: string | null;
  employeeEmail: string | null;
  phoneOffice: string | null;
  phoneMobile: string | null;
  status: string | null;
  sla: string;
  serviceLevel: string | null;
  shippingMethod: string | null;
  shippingReference: string | null;
  timeSl1Minutes: number;
  timeSl2Minutes: number;
  timeSl3Minutes: number;
  exported: boolean;
  returnRequired: boolean;
  returned: boolean;
  returnedAt: string | null;
  mail1SentAt: string | null;
  mail2SentAt: string | null;
  mail3SentAt: string | null;
  deviceOldType: string | null;
  deviceOldSerial: string | null;
  deviceNewType: string | null;
  deviceNewSerial: string | null;
  /** Combined Beschreibung / Lösung / leftover Geraetetyp notes → description. */
  description: string | null;
  /** Legacy Betreff kept only for test-row detection — never mapped to DB subject. */
  legacyBetreff: string | null;
  legacyBeschreibung: string | null;
  legacyLoesung: string | null;
  legacyGeraetetyp: string | null;
  isLikelyTest: boolean;
};

export type ParseSharePointReturnsCsvResult = {
  rows: ParsedSharePointReturnRow[];
  discoveredCatalogs: DiscoveredCatalogs;
  errors: string[];
};

export type ParseSharePointReturnsCsvOptions = {
  /** When true, include likely test rows (default true — flag only, do not drop). */
  includeTestRows?: boolean;
};

const IGNORED_HEADERS = new Set([
  'betreff',
  'mitarbeiterpers',
  'anlagen',
  'erledigt',
  'erledigtwann',
  'anfragetyp',
  'erstellt von',
  'erstelltvon',
  'geändert von',
  'geaendert von',
  'geaendertvon',
  'geändertvon',
]);

const HEADER_ALIASES: Record<string, string[]> = {
  id: ['id'],
  erstellt: ['erstellt'],
  ruecklieferungDatum: ['ruecklieferungdatum', 'rücklieferungdatum'],
  bearbeiter: ['bearbeiter'],
  mitarbeiter: ['mitarbeiter'],
  mitarbeiterEmail: ['mitarbeiteremail', 'mitarbeiter-email', 'mitarbeiter e-mail'],
  mitarbeiterTelefonBuero: [
    'mitarbeitertelefonbuero',
    'mitarbeitertelefonbüro',
    'mitarbeitertelefon',
  ],
  mitarbeiterMobil: ['mitarbeitermobil', 'mitarbeitermobile'],
  status: ['status'],
  sla: ['sla'],
  serviceLevel: ['servicelevel', 'service level'],
  versandart: ['versandart'],
  versand: ['versand'],
  benoetigteZeitSl1: ['benoetigtezeitsl1', 'benötigtezeitsl1', 'benoetigte zeit sl1'],
  benoetigteZeitSl2: ['benoetigtezeitsl2', 'benötigtezeitsl2', 'benoetigte zeit sl2'],
  benoetigteZeitSl3: ['benoetigtezeitsl3', 'benötigtezeitsl3', 'benoetigte zeit sl3'],
  exportiert: ['exportiert'],
  ruecklieferung: ['ruecklieferung', 'rücklieferung'],
  ruecklieferungErfolgt: ['ruecklieferungerfolgt', 'rücklieferungerfolgt'],
  rueckgeliefertWann: ['rueckgeliefertwann', 'rückgeliefertwann'],
  mail1Versendet: ['mail1versendet'],
  mail1VersendetDatum: ['mail1versendetdatum'],
  mail2Versendet: ['mail2versendet'],
  mail2VersendetDatum: ['mail2versendetdatum'],
  mail3Versendet: ['mail3versendet'],
  mail3VersendetDatum: ['mail3versendetdatum'],
  geraetetyp: ['geraetetyp', 'gerätetyp', 'gerätetypaltneu'],
  beschreibung: ['beschreibung'],
  loesung: ['loesung', 'lösung'],
  betreff: ['betreff'],
};

function stripBom(text: string): string {
  return String(text || '').replace(/^\uFEFF/, '');
}

function normalizeHeaderKey(raw: string): string {
  return String(raw || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ');
}

function buildHeaderIndex(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, idx) => {
    const key = normalizeHeaderKey(h);
    if (key) map[key] = idx;
  });
  return map;
}

function cellAt(row: string[], headerMap: Record<string, number>, aliases: string[]): string {
  for (const alias of aliases) {
    const idx = headerMap[alias];
    if (idx !== undefined && row[idx] !== undefined) {
      return String(row[idx] ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/^\t+/gm, '')
        .trim();
    }
  }
  return '';
}

/** German boolean: Ja/Wahr → true, Nein/Falsch → false, else null. */
export function parseGermanBoolean(raw: unknown): boolean | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (['ja', 'wahr', 'true', '1', 'yes', 'y'].includes(s)) return true;
  if (['nein', 'falsch', 'false', '0', 'no', 'n'].includes(s)) return false;
  return null;
}

/** German decimal `2,50` → 2.5 */
export function parseGermanDecimal(raw: unknown): number | null {
  const s = String(raw ?? '')
    .trim()
    .replace(/\s/g, '');
  if (!s) return null;
  const normalized = s.includes(',') && !s.includes('.')
    ? s.replace(/\./g, '').replace(',', '.')
    : s.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Benötigte Zeit (hours, possibly German decimal) → minutes. */
export function parseTimeHoursToMinutes(raw: unknown): number {
  const n = parseGermanDecimal(raw);
  if (n == null || n < 0) return 0;
  return Math.round(n * 60);
}

function getBerlinParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Convert Europe/Berlin wall time → UTC ISO timestamp. */
export function berlinWallTimeToUtcIso(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): string {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 4; i += 1) {
    const parts = getBerlinParts(new Date(utcMs));
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute, second);
    const delta = desired - asUtc;
    if (delta === 0) break;
    utcMs += delta;
  }
  return new Date(utcMs).toISOString();
}

const DE_DATE_RE =
  /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Parse German `DD.MM.YYYY` → `YYYY-MM-DD`, or `DD.MM.YYYY HH:mm` → UTC ISO.
 * Never returns locale strings like `"Fri Nov 20"`.
 */
export function parseGermanDate(
  raw: unknown,
  opts?: { asTimestamp?: boolean },
): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // Already ISO date / timestamp
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    if (opts?.asTimestamp) {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  const m = s.match(DE_DATE_RE);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dateOnly = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Date-only callers always get YYYY-MM-DD even when the source had HH:mm.
  if (!opts?.asTimestamp) return dateOnly;
  const hour = Number(m[4] || 0);
  const minute = Number(m[5] || 0);
  const second = Number(m[6] || 0);
  return berlinWallTimeToUtcIso(year, month, day, hour, minute, second);
}

function nullIfEmpty(s: string): string | null {
  const t = String(s || '').trim();
  return t ? t : null;
}

function resolveMailSentAt(params: {
  versendetRaw: string;
  datumRaw: string;
  erstelltFallback: string | null;
}): string | null {
  const flag = parseGermanBoolean(params.versendetRaw);
  if (flag === false || flag === null && !String(params.versendetRaw || '').trim()) {
    // Falsch / empty → null (ignore stale date when explicitly Falsch)
    if (flag === false) return null;
    // Empty flag with no date → null
    if (!String(params.datumRaw || '').trim()) return null;
  }
  if (flag === true) {
    const fromDatum = parseGermanDate(params.datumRaw, { asTimestamp: true });
    if (fromDatum) return fromDatum;
    if (params.erstelltFallback) {
      // Erstellt may be date-only — stamp as Berlin midnight
      const asTs = parseGermanDate(params.erstelltFallback, { asTimestamp: true });
      return asTs;
    }
    return null;
  }
  // Unknown flag but date present — only trust when Wahr-like already handled
  return null;
}

/** CRITICAL: never flag Secutest / Profitest (substring "test" is not a word). */
export function isLikelyTestRow(params: {
  betreff?: string | null;
  bearbeiter?: string | null;
  geraetetyp?: string | null;
  beschreibung?: string | null;
}): boolean {
  const betreff = String(params.betreff || '');
  const bearbeiter = String(params.bearbeiter || '');
  const geraetetyp = String(params.geraetetyp || '').trim();
  const beschreibung = String(params.beschreibung || '').trim();

  // `\btest` matches TestABC / "Audius Test"; Secutest/Profitest have no boundary before "test".
  if (/\btest/i.test(betreff) || /\btest/i.test(bearbeiter)) return true;

  if (/dfasdsasafa/i.test(geraetetyp)) return true;
  if (/^test1234$/i.test(geraetetyp)) return true;
  if (/test!\s*test!/i.test(geraetetyp)) return true;

  if (/^(tedst|test)/i.test(beschreibung)) return true;

  return false;
}

// ─── Device type normalization ───────────────────────────────────────────────

type DeviceRule = { name: string; match: (s: string) => boolean };

const DEVICE_RULES: DeviceRule[] = [
  {
    name: 'Secutest S2 N+10',
    match: (s) =>
      (/s2\s*n\+?\s*10/i.test(s) ||
        ((/(secutest|sacutest|seeutest|secutesat)/i.test(s) &&
          (/s\s*2/i.test(s) || /n\s*\+?\s*10/i.test(s))))),
  },
  {
    name: 'Secutest ST Pro',
    match: (s) =>
      /secutest/i.test(s) &&
      (/\bst\b/i.test(s) || /\bpro\b/i.test(s)) &&
      !/s\s*2|s-?4|n\s*\+?\s*10/i.test(s),
  },
  {
    name: 'Secutest S4',
    match: (s) => /secutest/i.test(s) && /s-?4/i.test(s),
  },
  {
    name: 'Secutest',
    match: (s) => /secutest|sacutest|seeutest|secutesat/i.test(s),
  },
  {
    name: 'Profitest MXtra IQ',
    match: (s) =>
      /mxtra\s*iq/i.test(s) ||
      (/(profitest|pofitest)/i.test(s) && /mxtra/i.test(s)) ||
      (/\bmxtra\b/i.test(s) && !/prime/i.test(s)),
  },
  {
    name: 'Profitest Prime',
    match: (s) => /(profitest|pofitest)/i.test(s) && /prime/i.test(s),
  },
  {
    name: 'Profitest',
    match: (s) => /profitest|pofitest/i.test(s),
  },
  {
    name: 'BT Adapter',
    match: (s) =>
      (/(\bbt\b|bluetooth|blueetooth|bluettoth)/i.test(s) && /adapter/i.test(s)) ||
      /rs-?232/i.test(s) ||
      /\bbt\b\s*(s\/?n|sn|pin|\d{4})\b/i.test(s) ||
      /^bt\s*adapter/i.test(s),
  },
  {
    name: 'VL2E Adapter',
    match: (s) => /vl2e/i.test(s),
  },
  {
    name: 'PRCD Adapter',
    match: (s) => /prcd/i.test(s),
  },
  {
    name: 'Getac Tablet (UX10)',
    match: (s) => /getac|getak/i.test(s) || /\bux10\b/i.test(s) || /dpg-ux\d+/i.test(s),
  },
  {
    name: 'Winmate Tablet (M101)',
    match: (s) => /winmate/i.test(s) || /\bm101\b/i.test(s) || /dpg-m101/i.test(s),
  },
  {
    name: 'Lenovo Laptop',
    match: (s) => /lenovo|thinkbook/i.test(s) || /dpg-l16/i.test(s),
  },
  {
    name: 'Dockingstation / Ladestation',
    match: (s) => /docking|ladestation/i.test(s),
  },
  {
    name: 'Handscanner / Barcode-Scanner',
    match: (s) => /handscanner|barcode|scanner/i.test(s) || /bcst\d+/i.test(s),
  },
  {
    name: 'Tastatur (Getac)',
    match: (s) => /tastatur/i.test(s),
  },
  {
    name: 'Sonde / Zubehör',
    match: (s) => /\bsonde\b|zubeh[oö]r/i.test(s),
  },
];

export function normalizeDeviceTypeName(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  for (const rule of DEVICE_RULES) {
    if (rule.match(s)) return rule.name;
  }
  return null;
}

function inferTypeFromSerialOrTag(token: string): string | null {
  const t = token.trim();
  if (/^dpg-ux/i.test(t) || /\bux10\b/i.test(t)) return 'Getac Tablet (UX10)';
  if (/^dpg-m101/i.test(t) || /\bm101\b/i.test(t)) return 'Winmate Tablet (M101)';
  if (/^dpg-l16/i.test(t)) return 'Lenovo Laptop';
  if (/^bcst\d+/i.test(t)) return 'Handscanner / Barcode-Scanner';
  return null;
}

const NULL_SERIAL_RE = /^(---|--|\?{2,3}|–|—)$/;

function isNullSerialMarker(raw: string): boolean {
  return NULL_SERIAL_RE.test(String(raw || '').trim());
}

/** Strip S/N: / SN: and internal spaces from serial-like tokens. */
export function cleanSerialToken(raw: string): string | null {
  let s = String(raw || '').trim();
  if (!s || isNullSerialMarker(s)) return null;
  s = s.replace(/^(s\/?n|sn)\s*[:.]?\s*/i, '').trim();
  if (isNullSerialMarker(s)) return null;
  // Remove spaces inside serials (BC 559053 0026 → BC5590530026)
  if (/^[A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)+$/.test(s) && !/\s{2,}/.test(s)) {
    const compact = s.replace(/\s+/g, '');
    if (/^[A-Z]{2}\d/i.test(compact) || /^[A-Z0-9-]{6,}$/i.test(compact)) {
      s = compact;
    }
  }
  return s || null;
}

const SERIAL_CANDIDATE_RES: RegExp[] = [
  /\b(DPG-[A-Z0-9-]+)\b/i,
  /\b(BCST\d+)\b/i,
  /\b([A-Z]{2}\d{8,12})\b/i,
  /\b([A-Z]{2}\d{6})\b/i,
  /\b([A-Z]{2,3}\d[A-Z0-9]{5,9})\b/i,
  /\b([A-Z]{2}\d{4})\b/i,
];

function extractSerialFromText(text: string, opts?: { allowFourDigit?: boolean }): string | null {
  const raw = String(text || '');
  const snMatch = raw.match(/(?:s\/?n|sn)\s*[:.]?\s*([A-Z0-9][A-Z0-9\s-]{2,})/i);
  if (snMatch) {
    const cleaned = cleanSerialToken(snMatch[1]);
    if (cleaned) return cleaned;
  }

  // Spaced BC serials before compaction
  const spacedBc = raw.match(/\b(BC(?:ST)?(?:\s+\d+){1,4})\b/i);
  if (spacedBc) {
    const cleaned = cleanSerialToken(spacedBc[1]);
    if (cleaned) return cleaned;
  }

  for (const re of SERIAL_CANDIDATE_RES) {
    const m = raw.match(re);
    if (m?.[1]) {
      const cleaned = cleanSerialToken(m[1]);
      if (cleaned) return cleaned;
    }
  }

  if (opts?.allowFourDigit) {
    const four = raw.match(/\b(\d{4})\b/);
    if (four) return four[1];
  }

  // Lone token that looks like a serial after ALT/NEU strip
  const lone = raw
    .replace(/^(alt|alte|r[uü]cklieferung|neu|neue|new)\b[:.\s-]*/i, '')
    .trim();
  if (lone && !normalizeDeviceTypeName(lone) && !/\s/.test(lone) && /^[A-Z0-9-]{4,}$/i.test(lone)) {
    if (isNullSerialMarker(lone)) return null;
    return cleanSerialToken(lone);
  }

  return null;
}

type Side = 'old' | 'new' | 'unknown';

function classifySide(segment: string): Side {
  const s = segment.trim();
  if (/^(alt|alte|r[uü]cklieferung)\b/i.test(s) || /\b(alt|alte)\b/i.test(s.split(/[/\n]/)[0] || '')) {
    if (/^(neu|neue|new)\b/i.test(s)) return 'new';
    return 'old';
  }
  if (/^(neu|neue|new)\b/i.test(s)) return 'new';
  return 'unknown';
}

function splitGeraetetypSegments(raw: string): string[] {
  const text = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!text) return [];

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const segments: string[] = [];

  for (const line of lines) {
    // Inline `/` before ALT|NEU markers
    const parts = line.split(/\s*\/\s*(?=(?:ALT|ALTE|RÜCKLIEFERUNG|RUECKLIEFERUNG|NEU|NEUE|NEW)\b)/i);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) segments.push(trimmed);
    }
  }
  return segments;
}

function parseOneDeviceSegment(segment: string): {
  side: Side;
  type: string | null;
  serial: string | null;
  leftover: string | null;
} {
  const side = classifySide(segment);
  let body = segment
    .replace(/^(alt|alte|r[uü]cklieferung|neu|neue|new)\b\s*[:.\-]?\s*/i, '')
    .trim();

  if (isNullSerialMarker(body)) {
    return { side, type: null, serial: null, leftover: null };
  }

  const type =
    normalizeDeviceTypeName(body) ||
    inferTypeFromSerialOrTag(body) ||
    null;

  const allowFourDigit = Boolean(type === 'BT Adapter' || /rs-?232|bt\b/i.test(body));
  let serial = extractSerialFromText(body, { allowFourDigit });

  // If body is only a serial marker / serial
  if (!serial && isNullSerialMarker(body)) serial = null;

  // Strip known type + serial from leftover notes
  let leftover = body;
  if (type) {
    leftover = leftover
      .replace(/secutest|sacutest|seeutest|secutesat|profitest|pofitest|mxtra\s*iq|mxtra|bt\s*adapter|bluetooth|vl2e|prcd|getac|getak|winmate|lenovo|thinkbook|docking(?:station)?|ladestation|handscanner|barcode|scanner|tastatur|sonde|zubeh[oö]r|adapter|s2\s*n\+?\s*10|st\s*pro|\bpro\b|s-?4|prime|ux10|m101|rs-?232/gi, ' ')
      .replace(/(?:s\/?n|sn)\s*[:.]?\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (serial) {
    leftover = leftover
      .split(/\s+/)
      .filter((tok) => tok.replace(/\s/g, '') !== serial && tok !== serial)
      .join(' ')
      .trim();
  }
  if (isNullSerialMarker(leftover) || !leftover) leftover = '';
  // Drop pure serial leftovers
  if (leftover && cleanSerialToken(leftover) === leftover && !/\s/.test(leftover)) {
    leftover = '';
  }

  return {
    side,
    type,
    serial,
    leftover: leftover || null,
  };
}

/**
 * Split combined free-text Geraetetyp into ALT/NEU type+serial + extraNotes.
 */
export function parseLegacyDeviceField(rawGeraetetyp: string): ParsedDeviceFields {
  const segments = splitGeraetetypSegments(rawGeraetetyp);
  if (!segments.length) {
    return {
      deviceOldType: null,
      deviceOldSerial: null,
      deviceNewType: null,
      deviceNewSerial: null,
      extraNotes: null,
    };
  }

  let deviceOldType: string | null = null;
  let deviceOldSerial: string | null = null;
  let deviceNewType: string | null = null;
  let deviceNewSerial: string | null = null;
  const notes: string[] = [];
  const extras: string[] = [];

  const parsed = segments.map(parseOneDeviceSegment);

  // Assign known sides first
  for (const p of parsed) {
    if (p.side === 'old') {
      if (p.type && !deviceOldType) deviceOldType = p.type;
      if (p.serial && !deviceOldSerial) deviceOldSerial = p.serial;
      else if (p.serial && deviceOldSerial && p.serial !== deviceOldSerial) {
        extras.push(`ALT ${p.type || ''} ${p.serial}`.trim());
      }
      if (p.leftover) notes.push(p.leftover);
    } else if (p.side === 'new') {
      if (p.type && !deviceNewType) deviceNewType = p.type;
      else if (p.type && deviceNewType && p.type !== deviceNewType) {
        extras.push(`+ ${p.type}`);
      }
      if (p.serial && !deviceNewSerial) deviceNewSerial = p.serial;
      else if (p.serial && deviceNewSerial && p.serial !== deviceNewSerial) {
        extras.push(`NEU ${p.type || ''} ${p.serial}`.trim());
      }
      if (p.leftover) notes.push(p.leftover);
    } else {
      // unknown side — fill first empty slot, else notes
      if (!deviceOldType && !deviceOldSerial && (p.type || p.serial)) {
        deviceOldType = p.type;
        deviceOldSerial = p.serial;
      } else if (!deviceNewType && !deviceNewSerial && (p.type || p.serial)) {
        deviceNewType = p.type;
        deviceNewSerial = p.serial;
      } else if (p.type || p.serial || p.leftover) {
        extras.push([p.type, p.serial, p.leftover].filter(Boolean).join(' '));
      }
      if (p.leftover && !extras.includes(p.leftover)) notes.push(p.leftover);
    }
  }

  // Inherit type from sibling when one side only has a serial
  const sharedType = deviceOldType || deviceNewType;
  if (!deviceOldType && deviceOldSerial && sharedType) deviceOldType = sharedType;
  if (!deviceNewType && deviceNewSerial && sharedType) deviceNewType = sharedType;

  // Infer from serial/asset prefixes
  if (!deviceOldType && deviceOldSerial) {
    deviceOldType = inferTypeFromSerialOrTag(deviceOldSerial);
  }
  if (!deviceNewType && deviceNewSerial) {
    deviceNewType = inferTypeFromSerialOrTag(deviceNewSerial);
  }
  // Re-inherit after inference
  if (!deviceOldType && deviceOldSerial && deviceNewType) deviceOldType = deviceNewType;
  if (!deviceNewType && deviceNewSerial && deviceOldType) deviceNewType = deviceOldType;

  // BT Adapter 4-digit inheritance context
  if (
    (deviceNewType === 'BT Adapter' || deviceOldType === 'BT Adapter') &&
    deviceOldSerial == null
  ) {
    const oldSeg = parsed.find((p) => p.side === 'old');
    if (oldSeg) {
      const four = extractSerialFromText(oldSeg.leftover || '', { allowFourDigit: true });
      // already handled in parseOneDeviceSegment with allowFourDigit when type known —
      // re-parse old body for 4-digit when sibling is BT
      const rawOld = segments.find((s) => classifySide(s) === 'old');
      if (rawOld) {
        const body = rawOld.replace(/^(alt|alte|r[uü]cklieferung)\b\s*[:.\-]?\s*/i, '').trim();
        if (/^\d{4}$/.test(body)) {
          deviceOldSerial = body;
          deviceOldType = deviceOldType || 'BT Adapter';
        }
      }
    }
  }

  const extraNotes = [...notes, ...extras]
    .map((n) => n.trim())
    .filter(Boolean)
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .join('\n')
    .trim();

  return {
    deviceOldType,
    deviceOldSerial,
    deviceNewType,
    deviceNewSerial,
    extraNotes: extraNotes || null,
  };
}

function dedupeCatalog(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = String(v || '').trim();
    if (!t) continue;
    // Never put raw serials into catalogs
    if (/^(DPG-|BCST|[A-Z]{2}\d{4,}|[A-Z]{2}\d{6,})/i.test(t) && !/[a-z].*[a-z]/i.test(t.replace(/[^a-z]/gi, ''))) {
      // Heuristic: token that looks like serial-only
      if (/^[A-Z0-9-]{4,}$/i.test(t) && !/\s/.test(t) && !DEVICE_RULES.some((r) => r.name === t)) {
        continue;
      }
    }
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function looksLikeSerialOnly(value: string): boolean {
  const t = value.trim();
  if (!t || /\s/.test(t)) return false;
  if (DEVICE_RULES.some((r) => r.name === t)) return false;
  if (/^(DPG-[A-Z0-9-]+|BCST\d+)$/i.test(t)) return true;
  if (/^[A-Z]{2}\d{4,}$/i.test(t)) return true;
  if (/^\d{4}$/.test(t)) return true;
  return false;
}

/**
 * Parse Ticketsystem_DPG.csv into structured return rows + discovered catalogs.
 */
export function parseSharePointReturnsCsv(
  csvText: string,
  options: ParseSharePointReturnsCsvOptions = {},
): ParseSharePointReturnsCsvResult {
  const includeTestRows = options.includeTestRows !== false;
  const matrix = parseCsvMatrix(stripBom(csvText));
  const errors: string[] = [];
  if (matrix.length < 2) {
    return {
      rows: [],
      discoveredCatalogs: {
        device_types: [],
        shipping_methods: [],
        statuses: [],
        slas: [],
        service_levels: [],
      },
      errors: matrix.length === 0 ? ['CSV leer'] : ['CSV hat keine Datenzeilen'],
    };
  }

  const headerMap = buildHeaderIndex(matrix[0]);
  // Ensure ignored headers are not required (Betreff still read for test detection only)
  void IGNORED_HEADERS;

  const get = (row: string[], key: keyof typeof HEADER_ALIASES) =>
    cellAt(row, headerMap, HEADER_ALIASES[key]);

  const rows: ParsedSharePointReturnRow[] = [];
  const deviceTypes: string[] = [];
  const shippingMethods: string[] = [];
  const statuses: string[] = [];
  const slas: string[] = [];
  const serviceLevels: string[] = [];

  for (let i = 1; i < matrix.length; i += 1) {
    const raw = matrix[i];
    try {
      const idRaw = get(raw, 'id');
      const erstelltRaw = get(raw, 'erstellt');
      const betreff = get(raw, 'betreff');
      const bearbeiter = get(raw, 'bearbeiter');
      const geraetetyp = get(raw, 'geraetetyp');
      const beschreibung = get(raw, 'beschreibung');
      const loesung = get(raw, 'loesung');

      const empty =
        !idRaw &&
        !erstelltRaw &&
        !get(raw, 'mitarbeiter') &&
        !geraetetyp &&
        !beschreibung;
      if (empty) continue;

      const deliveryDate = parseGermanDate(erstelltRaw, { asTimestamp: false });
      const createdAt = parseGermanDate(erstelltRaw, { asTimestamp: true });
      const returnDueDate = parseGermanDate(get(raw, 'ruecklieferungDatum'), {
        asTimestamp: false,
      });

      const devices = parseLegacyDeviceField(geraetetyp);
      const descParts = [beschreibung, loesung, devices.extraNotes]
        .map((p) => String(p || '').trim())
        .filter(Boolean);
      const description = descParts.length ? descParts.join('\n\n') : null;

      const returnRequired = parseGermanBoolean(get(raw, 'ruecklieferung')) ?? false;
      const returned = parseGermanBoolean(get(raw, 'ruecklieferungErfolgt')) ?? false;
      const returnedAt = returned
        ? parseGermanDate(get(raw, 'rueckgeliefertWann'), { asTimestamp: true })
        : null;

      const mail1SentAt = resolveMailSentAt({
        versendetRaw: get(raw, 'mail1Versendet'),
        datumRaw: get(raw, 'mail1VersendetDatum'),
        erstelltFallback: erstelltRaw,
      });
      const mail2SentAt = resolveMailSentAt({
        versendetRaw: get(raw, 'mail2Versendet'),
        datumRaw: get(raw, 'mail2VersendetDatum'),
        erstelltFallback: erstelltRaw,
      });
      const mail3SentAt = resolveMailSentAt({
        versendetRaw: get(raw, 'mail3Versendet'),
        datumRaw: get(raw, 'mail3VersendetDatum'),
        erstelltFallback: erstelltRaw,
      });

      const status = nullIfEmpty(get(raw, 'status'));
      const sla = nullIfEmpty(get(raw, 'sla')) || 'Normal';
      const serviceLevel = nullIfEmpty(get(raw, 'serviceLevel'));
      const shippingMethod = nullIfEmpty(get(raw, 'versandart'));
      const shippingReference = nullIfEmpty(get(raw, 'versand'));

      const isTest = isLikelyTestRow({
        betreff,
        bearbeiter,
        geraetetyp,
        beschreibung,
      });
      if (isTest && !includeTestRows) continue;

      const externalRefId = nullIfEmpty(idRaw);
      const externalRefNumeric =
        externalRefId && /^\d+$/.test(externalRefId) ? Number(externalRefId) : null;

      const row: ParsedSharePointReturnRow = {
        rowIndex: i,
        externalRefId,
        externalRefNumeric,
        createdAt,
        deliveryDate,
        returnDueDate,
        assigneeName: nullIfEmpty(bearbeiter),
        employeeName: nullIfEmpty(get(raw, 'mitarbeiter')),
        employeeEmail: nullIfEmpty(get(raw, 'mitarbeiterEmail')),
        phoneOffice: nullIfEmpty(get(raw, 'mitarbeiterTelefonBuero')),
        phoneMobile: nullIfEmpty(get(raw, 'mitarbeiterMobil')),
        status,
        sla,
        serviceLevel,
        shippingMethod,
        shippingReference,
        timeSl1Minutes: parseTimeHoursToMinutes(get(raw, 'benoetigteZeitSl1')),
        timeSl2Minutes: parseTimeHoursToMinutes(get(raw, 'benoetigteZeitSl2')),
        timeSl3Minutes: parseTimeHoursToMinutes(get(raw, 'benoetigteZeitSl3')),
        exported: parseGermanBoolean(get(raw, 'exportiert')) ?? false,
        returnRequired,
        returned,
        returnedAt,
        mail1SentAt,
        mail2SentAt,
        mail3SentAt,
        deviceOldType: devices.deviceOldType,
        deviceOldSerial: devices.deviceOldSerial,
        deviceNewType: devices.deviceNewType,
        deviceNewSerial: devices.deviceNewSerial,
        description,
        legacyBetreff: nullIfEmpty(betreff),
        legacyBeschreibung: nullIfEmpty(beschreibung),
        legacyLoesung: nullIfEmpty(loesung),
        legacyGeraetetyp: nullIfEmpty(geraetetyp),
        isLikelyTest: isTest,
      };
      rows.push(row);

      if (row.deviceOldType) deviceTypes.push(row.deviceOldType);
      if (row.deviceNewType) deviceTypes.push(row.deviceNewType);
      if (shippingMethod && !looksLikeSerialOnly(shippingMethod)) {
        shippingMethods.push(shippingMethod);
      }
      if (status) statuses.push(status);
      if (sla) slas.push(sla);
      if (serviceLevel) serviceLevels.push(serviceLevel);
    } catch (err) {
      errors.push(
        `Zeile ${i + 1}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    rows,
    discoveredCatalogs: {
      device_types: dedupeCatalog(deviceTypes).filter((t) => !looksLikeSerialOnly(t)),
      shipping_methods: dedupeCatalog(shippingMethods),
      statuses: dedupeCatalog(statuses),
      slas: dedupeCatalog(slas),
      service_levels: dedupeCatalog(serviceLevels),
    },
    errors,
  };
}
