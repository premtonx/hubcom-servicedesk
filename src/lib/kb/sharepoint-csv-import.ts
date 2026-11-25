/**
 * SharePoint / PowerApps Wissensdatenbank CSV parser + title/markdown assembly.
 * Pure (no DB) — used by staff/portal import endpoints and the 2-step preview UI.
 */

export type SharePointCsvRow = {
  id: string;
  matchcode: string;
  problem: string;
  exactProblem: string;
  solution: string;
  website: string;
  anlagen: string;
  /** Original row index in the CSV (1-based data row). */
  rowIndex: number;
};

export type SharePointPreviewArticle = {
  /** Stable client key (SP-ID or row index). */
  key: string;
  sharePointId: string;
  matchcode: string;
  title: string;
  content: string;
  contentPreview: string;
  hasAttachments: boolean;
  hasLink: boolean;
  /** Likely fixture / test row — UI auto-unchecks. */
  isLikelyTest: boolean;
  raw: SharePointCsvRow;
};

const HEADER_ALIASES: Record<keyof Omit<SharePointCsvRow, 'rowIndex'>, string[]> = {
  id: ['id'],
  matchcode: ['matchcode'],
  problem: ['problem', 'problembeschreibung'],
  exactProblem: ['genaueproblembeschreibung', 'genaue problembeschreibung'],
  solution: ['loesungsweg', 'lösungsweg', 'losungsweg'],
  website: ['webseite', 'webseite oder link zu datei'],
  anlagen: ['anlagen'],
};

function stripBom(text: string): string {
  return String(text || '').replace(/^\uFEFF/, '');
}

/** Normalize leading tabs so Markdown does not treat prose as indented code. */
export function normalizeLeadingTabs(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\t+/, ''))
    .join('\n');
}

function detectDelimiter(headerLine: string): ',' | ';' {
  let commas = 0;
  let semis = 0;
  let inQuotes = false;
  for (let i = 0; i < headerLine.length; i += 1) {
    const ch = headerLine[i];
    if (ch === '"') {
      if (inQuotes && headerLine[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === ',') commas += 1;
    if (ch === ';') semis += 1;
  }
  return semis > commas ? ';' : ',';
}

/** RFC-4180 CSV parse with `,` / `;` delimiter and multi-line quoted cells. */
export function parseCsvMatrix(text: string): string[][] {
  const input = stripBom(text);
  if (!input.trim()) return [];

  const firstLineEnd = (() => {
    let inQuotes = false;
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (ch === '"') {
        if (inQuotes && input[i + 1] === '"') {
          i += 1;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && (ch === '\n' || ch === '\r')) return i;
    }
    return input.length;
  })();
  const delimiter = detectDelimiter(input.slice(0, firstLineEnd));

  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(current);
      if (row.some((cell) => String(cell).trim().length > 0)) rows.push(row);
      row = [];
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    if (row.some((cell) => String(cell).trim().length > 0)) rows.push(row);
  }

  return rows;
}

function normalizeHeaderKey(raw: string): string {
  return String(raw || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
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

function cellAt(
  row: string[],
  headerMap: Record<string, number>,
  aliases: string[],
): string {
  for (const alias of aliases) {
    const idx = headerMap[alias];
    if (idx !== undefined && row[idx] !== undefined) {
      return normalizeLeadingTabs(String(row[idx] ?? '')).trimEnd();
    }
  }
  return '';
}

export function parseSharePointCsvRows(csvText: string): SharePointCsvRow[] {
  const matrix = parseCsvMatrix(csvText);
  if (matrix.length < 2) return [];

  const headerMap = buildHeaderIndex(matrix[0]);
  const rows: SharePointCsvRow[] = [];

  for (let i = 1; i < matrix.length; i += 1) {
    const raw = matrix[i];
    const id = cellAt(raw, headerMap, HEADER_ALIASES.id).trim();
    const matchcode = cellAt(raw, headerMap, HEADER_ALIASES.matchcode).trim();
    const problem = cellAt(raw, headerMap, HEADER_ALIASES.problem);
    const exactProblem = cellAt(raw, headerMap, HEADER_ALIASES.exactProblem);
    const solution = cellAt(raw, headerMap, HEADER_ALIASES.solution);
    const website = cellAt(raw, headerMap, HEADER_ALIASES.website).trim();
    const anlagen = cellAt(raw, headerMap, HEADER_ALIASES.anlagen).trim();

    // Skip completely empty data rows.
    if (![id, matchcode, problem, exactProblem, solution, website, anlagen].some((v) => v.trim())) {
      continue;
    }

    rows.push({
      id,
      matchcode,
      problem,
      exactProblem,
      solution,
      website,
      anlagen,
      rowIndex: i,
    });
  }

  return rows;
}

/** First non-empty Problem line, trimmed of trailing `:` and leading `- `/`=> `. */
export function extractProblemFirstLine(problem: string): string {
  const lines = normalizeLeadingTabs(problem)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  let line = lines[0];
  line = line.replace(/:$/, '').trim();
  line = line.replace(/^-\s+/, '').replace(/^=>\s+/, '').trim();
  return line;
}

function rawProblemFirstLineStartsWithDash(problem: string): boolean {
  const lines = normalizeLeadingTabs(problem)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  return lines[0].startsWith('-');
}

export function countMatchcodeOccurrences(rows: SharePointCsvRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.matchcode.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * Smart unique title — avoids collapsing rows that share a short / duplicate Matchcode.
 */
export function buildSmartTitle(
  row: SharePointCsvRow,
  matchcodeCounts: Map<string, number>,
): string {
  const matchcode = row.matchcode.trim();
  const problemFirstLine = extractProblemFirstLine(row.problem);

  if (!matchcode) {
    return problemFirstLine || `Artikel ${row.id || row.rowIndex}`;
  }

  const count = matchcodeCounts.get(matchcode) || 1;
  const isShort = matchcode.length <= 18;
  const isDuplicate = count > 1;
  const problemStartsWithDash = rawProblemFirstLineStartsWithDash(row.problem);

  if ((isShort || isDuplicate) && !problemStartsWithDash && problemFirstLine) {
    if (problemFirstLine.toLowerCase().includes(matchcode.toLowerCase())) {
      return problemFirstLine;
    }
    return `${matchcode} – ${problemFirstLine}`;
  }

  return matchcode;
}

export function ensureAbsoluteUrl(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return `https://${value}`;
}

export function assembleMarkdownBody(params: {
  title: string;
  problem: string;
  exactProblem: string;
  solution: string;
  website: string;
}): string {
  const problem = normalizeLeadingTabs(params.problem).trim();
  const exact = normalizeLeadingTabs(params.exactProblem).trim();
  const solution = normalizeLeadingTabs(params.solution).trim();
  const website = String(params.website || '').trim();
  const title = String(params.title || '').trim();

  const sections: string[] = [];

  const problemLines = problem
    ? problem
        .split('\n')
        .map((l) => l.trimEnd())
        .filter((l, idx, arr) => !(idx === arr.length - 1 && !l.trim()) || arr.length === 1)
    : [];
  const problemIsSingleLine = problemLines.filter((l) => l.trim()).length <= 1;
  const problemEqualsTitle =
    problemIsSingleLine &&
    problemLines.map((l) => l.trim()).join('') === title;

  let problemSectionBody = '';
  if (problemEqualsTitle && exact) {
    // Skip repeating the title-identical single-line Problem when exact detail exists.
    problemSectionBody = exact;
  } else if (problemEqualsTitle && !exact) {
    // Keep Problem when it is the only description.
    problemSectionBody = problem;
  } else if (problem && exact) {
    problemSectionBody = `${problem}\n\n${exact}`;
  } else if (problem) {
    problemSectionBody = problem;
  } else if (exact) {
    problemSectionBody = exact;
  }

  if (problemSectionBody.trim()) {
    sections.push(`## Problembeschreibung\n\n${problemSectionBody.trim()}`);
  }

  if (solution) {
    sections.push(`## Lösungsweg\n\n${solution}`);
  }

  if (website) {
    const href = ensureAbsoluteUrl(website);
    sections.push(`## Weiterführender Link\n\n[${href}](${href})`);
  }

  return sections.join('\n\n').trim();
}

export function hasSharePointAttachments(anlagen: string): boolean {
  return String(anlagen || '').trim() === '1';
}

const TEST_TITLE_RE = /^(test\d*|test123456789)$/i;

export function isLikelyTestSharePointRow(params: {
  title: string;
  matchcode: string;
}): boolean {
  const title = String(params.title || '').trim();
  const matchcode = String(params.matchcode || '').trim();
  return TEST_TITLE_RE.test(title) || TEST_TITLE_RE.test(matchcode);
}

export function contentPreview(markdown: string, max = 160): string {
  const plain = String(markdown || '')
    .replace(/^#+\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1)}…`;
}

export function buildSharePointPreviewArticles(csvText: string): SharePointPreviewArticle[] {
  const rows = parseSharePointCsvRows(csvText);
  const counts = countMatchcodeOccurrences(rows);

  return rows.map((row) => {
    const title = buildSmartTitle(row, counts);
    const content = assembleMarkdownBody({
      title,
      problem: row.problem,
      exactProblem: row.exactProblem,
      solution: row.solution,
      website: row.website,
    });
    const hasAttachments = hasSharePointAttachments(row.anlagen);
    const hasLink = Boolean(row.website.trim());
    return {
      key: row.id || `row-${row.rowIndex}`,
      sharePointId: row.id,
      matchcode: row.matchcode,
      title,
      content,
      contentPreview: contentPreview(content),
      hasAttachments,
      hasLink,
      isLikelyTest: isLikelyTestSharePointRow({ title, matchcode: row.matchcode }),
      raw: row,
    };
  });
}

export function normalizeArticleTitleKey(title: string): string {
  return String(title || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
