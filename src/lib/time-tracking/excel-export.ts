import fs from 'fs/promises';
import path from 'path';
import ExcelJS from 'exceljs';
import type { TimeEntry } from './types.js';

export const TIME_EXPORT_COLUMNS = [
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
] as const;

export function getTimeExportDir(): string {
  return (
    process.env.TIME_EXPORT_DIR ||
    path.join(process.cwd(), 'storage', 'time-exports')
  );
}

function entryToRow(entry: TimeEntry): (string | number)[] {
  return [
    entry.ticketNumber,
    entry.ticketSubject,
    entry.customerCompany,
    entry.date,
    entry.agentName,
    entry.kuerzel,
    entry.hours,
    entry.sonderzahlung ? 'Ja' : 'Nein',
    entry.hourlyRate,
    entry.totalAmount,
    entry.description,
    entry.id,
  ];
}

export async function buildTimeEntriesWorkbook(entries: TimeEntry[]): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hubcom ServiceDesk';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Zeiterfassung', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: 'Ticket-Nr.', key: 'ticketNumber', width: 14 },
    { header: 'Betreff', key: 'ticketSubject', width: 36 },
    { header: 'Kunde', key: 'customerCompany', width: 24 },
    { header: 'Datum', key: 'date', width: 12 },
    { header: 'Mitarbeiter', key: 'agentName', width: 22 },
    { header: 'Kürzel', key: 'kuerzel', width: 10 },
    { header: 'Stunden', key: 'hours', width: 10 },
    { header: 'Sonderzahlung', key: 'sonderzahlung', width: 14 },
    { header: 'Stundensatz (€)', key: 'hourlyRate', width: 16 },
    { header: 'Gesamtbetrag (€)', key: 'totalAmount', width: 16 },
    { header: 'Beschreibung', key: 'description', width: 40 },
    { header: 'Entry-ID', key: 'id', width: 28 },
  ];

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0B1F3A' },
  };

  for (const entry of entries) {
    sheet.addRow({
      ticketNumber: entry.ticketNumber,
      ticketSubject: entry.ticketSubject,
      customerCompany: entry.customerCompany,
      date: entry.date,
      agentName: entry.agentName,
      kuerzel: entry.kuerzel,
      hours: entry.hours,
      sonderzahlung: entry.sonderzahlung ? 'Ja' : 'Nein',
      hourlyRate: entry.hourlyRate,
      totalAmount: entry.totalAmount,
      description: entry.description,
      id: entry.id,
    });
  }

  sheet.getColumn('hours').numFmt = '0.00';
  sheet.getColumn('hourlyRate').numFmt = '#,##0.00';
  sheet.getColumn('totalAmount').numFmt = '#,##0.00';

  return workbook;
}

export async function buildTimeEntriesBuffer(entries: TimeEntry[]): Promise<Buffer> {
  const workbook = await buildTimeEntriesWorkbook(entries);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/** Speichert eine Gesamt-Excel-Datei im lokalen Storage (für Background-Job). */
export async function writeTimeEntriesExportFile(entries: TimeEntry[]): Promise<string> {
  const dir = getTimeExportDir();
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(dir, `zeiterfassung-gesamt-${stamp}.xlsx`);
  const latestPath = path.join(dir, 'zeiterfassung-gesamt-aktuell.xlsx');
  const buffer = await buildTimeEntriesBuffer(entries);
  await fs.writeFile(filePath, buffer);
  await fs.writeFile(latestPath, buffer);
  return latestPath;
}

export { entryToRow };
