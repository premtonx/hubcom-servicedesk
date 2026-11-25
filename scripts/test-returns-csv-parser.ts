/**
 * Unit tests for SharePoint Hardware-Rücklieferungen CSV parser (Part 1/3).
 * Usage: npm run test:returns-csv-parser
 */

import {
  isLikelyTestRow,
  parseGermanBoolean,
  parseGermanDate,
  parseGermanDecimal,
  parseLegacyDeviceField,
  parseSharePointReturnsCsv,
  parseTimeHoursToMinutes,
} from '../src/lib/client-portal/hardware-returns-csv-parser.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function testLocaleParsers(): void {
  console.log('\n[1] German locale parsers');
  assert(parseGermanBoolean('Ja') === true, 'Ja → true');
  assert(parseGermanBoolean('Wahr') === true, 'Wahr → true');
  assert(parseGermanBoolean('Nein') === false, 'Nein → false');
  assert(parseGermanBoolean('Falsch') === false, 'Falsch → false');
  assert(parseGermanDecimal('2,50') === 2.5, '2,50 → 2.5');
  assert(parseTimeHoursToMinutes('2,50') === 150, '2,50h → 150 minutes');
  assert(parseGermanDate('20.11.2026') === '2026-11-20', 'DD.MM.YYYY → YYYY-MM-DD');
  const ts = parseGermanDate('20.11.2026 14:30', { asTimestamp: true });
  assert(
    Boolean(ts && ts.startsWith('2026-11-20T') && ts.endsWith('Z')),
    'DD.MM.YYYY HH:mm → UTC ISO (Berlin)',
    String(ts),
  );
  assert(parseGermanDate('Fri Nov 20') === null, 'rejects English locale date strings');
}

function testDeviceSplits(): void {
  console.log('\n[2] parseLegacyDeviceField — ALT/NEU splits');

  const a = parseLegacyDeviceField('ALT BC 559053 0026\nNEU Secutest S2 N+10 S/N: EA7101520016');
  assert(
    a.deviceOldSerial === 'BC5590530026' &&
      a.deviceNewType === 'Secutest S2 N+10' &&
      a.deviceNewSerial === 'EA7101520016',
    'ALT spaced BC serial + NEU Secutest S2 N+10',
    JSON.stringify(a),
  );

  const b = parseLegacyDeviceField('ALT DPG-UX10G3-121\nNEU DPG-UX10G3-050');
  assert(
    b.deviceOldType === 'Getac Tablet (UX10)' &&
      b.deviceOldSerial === 'DPG-UX10G3-121' &&
      b.deviceNewType === 'Getac Tablet (UX10)' &&
      b.deviceNewSerial === 'DPG-UX10G3-050',
    'DPG-UX asset tags infer Getac Tablet (UX10)',
    JSON.stringify(b),
  );

  const c = parseLegacyDeviceField('ALT ZG1710\nNEU Mxtra IQ S/N: HA0478');
  assert(
    c.deviceOldSerial === 'ZG1710' &&
      c.deviceNewType === 'Profitest MXtra IQ' &&
      c.deviceNewSerial === 'HA0478' &&
      c.deviceOldType === 'Profitest MXtra IQ',
    'ALT serial inherits Profitest MXtra IQ from NEU',
    JSON.stringify(c),
  );

  const d = parseLegacyDeviceField('ALT 3216\nNEU BT Adapter S/N 3208');
  assert(
    d.deviceOldSerial === '3216' &&
      d.deviceNewType === 'BT Adapter' &&
      d.deviceNewSerial === '3208' &&
      d.deviceOldType === 'BT Adapter',
    '4-digit BT serials + inherit BT Adapter',
    JSON.stringify(d),
  );

  const e = parseLegacyDeviceField('ALT ---\nNEU Secutest PRO S/N HL7578850006');
  assert(
    e.deviceOldSerial === null &&
      e.deviceNewType === 'Secutest ST Pro' &&
      e.deviceNewSerial === 'HL7578850006',
    'ALT --- → null serial; Secutest PRO → ST Pro',
    JSON.stringify(e),
  );

  const f = parseLegacyDeviceField(
    'ALT Secutest S2 N+10 S/N EA111\nNEU Secutest S2 N+10 S/N EA222\n+ BT Adapter / DHL-Paket verloren',
  );
  assert(
    Boolean(f.extraNotes && /BT Adapter|DHL/i.test(f.extraNotes)),
    'extra multi-device lines / remarks preserved in extraNotes',
    JSON.stringify(f.extraNotes),
  );
}

function testLikelyTestRows(): void {
  console.log('\n[3] isLikelyTestRow — Secutest/Profitest safe');

  assert(
    isLikelyTestRow({ betreff: 'Secutest S2 N+10 Tausch', geraetetyp: 'Secutest' }) === false,
    'Secutest NOT flagged as test',
  );
  assert(
    isLikelyTestRow({ betreff: 'Profitest MXtra IQ', bearbeiter: 'Max Mustermann' }) === false,
    'Profitest NOT flagged as test',
  );
  assert(
    isLikelyTestRow({ betreff: 'TestABC' }) === true,
    'TestABC flagged',
  );
  assert(
    isLikelyTestRow({ betreff: 'Audius Test' }) === true,
    'Audius Test flagged',
  );
  assert(
    isLikelyTestRow({ geraetetyp: 'Test! Test!' }) === true,
    'Test! Test! flagged',
  );
  assert(
    isLikelyTestRow({ geraetetyp: 'test1234' }) === true,
    'test1234 flagged',
  );
  assert(
    isLikelyTestRow({ geraetetyp: 'dfasdsasafa' }) === true,
    'dfasdsasafa flagged',
  );
  assert(
    isLikelyTestRow({ beschreibung: 'tedst foo' }) === true,
    'beschreibung starting with tedst flagged',
  );
  assert(
    isLikelyTestRow({ beschreibung: 'test something' }) === true,
    'beschreibung starting with test flagged',
  );
  assert(
    isLikelyTestRow({ bearbeiter: 'Test User' }) === true,
    'Bearbeiter with \\btest flagged',
  );
}

function testMailSentAtLogic(): void {
  console.log('\n[4] Mail1/2/3 Versendet date rules');

  const csv =
    '\uFEFF' +
    [
      'ID;Erstellt;RuecklieferungDatum;Bearbeiter;Mitarbeiter;MitarbeiterEMail;Status;SLA;ServiceLevel;Versandart;Versand;BenoetigteZeitSL1;BenoetigteZeitSL2;BenoetigteZeitSL3;Exportiert;Ruecklieferung;RuecklieferungErfolgt;RueckgeliefertWann;Mail1Versendet;Mail1VersendetDatum;Mail2Versendet;Mail2VersendetDatum;Mail3Versendet;Mail3VersendetDatum;Geraetetyp;Beschreibung;Loesung;Betreff',
      '10;01.10.2026 09:00;15.10.2026;Ada Lovelace;Max Mustermann;max@dpg.test;In Bearbeitung;Normal;2;Express;DHL123;1,50;0;0;Nein;Ja;Nein;;Wahr;;Falsch;01.09.2026;Falsch;15.09.2026;"ALT BC 559053 0026\nNEU Secutest S2 N+10 S/N: EA7101520016";Gerät defekt;Getauscht;Secutest Tausch',
      '11;02.10.2026;16.10.2026;Test User;Y;y@dpg.test;Neu;Normal;1;Standard;;0;0;0;Nein;Ja;Nein;;Falsch;01.09.2026;Falsch;;Falsch;;"Test! Test!";test junk;;TestABC',
    ].join('\n');

  const result = parseSharePointReturnsCsv(csv);
  assert(result.rows.length === 2, 'parses BOM + semicolon CSV with 2 rows');

  const row = result.rows[0];
  assert(row.externalRefId === '10' && row.externalRefNumeric === 10, 'ID → externalRefId + numeric');
  assert(row.deliveryDate === '2026-10-01', 'Erstellt → deliveryDate YYYY-MM-DD');
  assert(row.returnDueDate === '2026-10-15', 'RuecklieferungDatum used as-is (no +14)');
  assert(row.assigneeName === 'Ada Lovelace', 'Bearbeiter → assigneeName');
  assert(
    row.employeeName === 'Max Mustermann' && row.employeeEmail === 'max@dpg.test',
    'Mitarbeiter fields mapped',
  );
  assert(row.sla === 'Normal' && row.serviceLevel === '2', 'SLA default/path + ServiceLevel');
  assert(row.shippingMethod === 'Express' && row.shippingReference === 'DHL123', 'Versandart/Versand');
  assert(row.timeSl1Minutes === 90, 'BenoetigteZeitSL1 1,50h → 90 min');
  assert(row.returnRequired === true && row.returned === false, 'Ruecklieferung flags');
  assert(
    row.mail1SentAt != null && row.mail1SentAt.startsWith('2026-10-01'),
    'Mail1 Wahr + empty date → fallback Erstellt',
    String(row.mail1SentAt),
  );
  assert(row.mail3SentAt === null, 'Mail3 Falsch + stale date → null');
  assert(row.mail2SentAt === null, 'Mail2 Falsch → null');
  assert(
    row.deviceNewType === 'Secutest S2 N+10' && row.deviceOldSerial === 'BC5590530026',
    'Geraetetyp split into device fields',
  );
  assert(row.isLikelyTest === false, 'Secutest row is not a test row');

  const testRow = result.rows[1];
  assert(testRow.isLikelyTest === true, 'TestABC / Test! Test! / Test User flagged');

  assert(
    result.discoveredCatalogs.device_types.includes('Secutest S2 N+10') &&
      !result.discoveredCatalogs.device_types.some((t) => /EA7101520016|BC5590530026/.test(t)),
    'discoveredCatalogs has clean device types, zero raw serials',
  );
}

function testMoreDeviceFixtures(): void {
  console.log('\n[5] Additional device / catalog fixtures');

  const csv = [
    'ID,Erstellt,Geraetetyp,Status,SLA,ServiceLevel,Versandart,Ruecklieferung,RuecklieferungErfolgt,Mail1Versendet,Mail1VersendetDatum,Mail3Versendet,Mail3VersendetDatum,Beschreibung,Betreff,Bearbeiter',
    '21,05.10.2026,"ALT ZG1710\nNEU Mxtra IQ S/N: HA0478",Neu,Normal,1,Standard,Ja,Nein,Wahr,,Falsch,01.01.2020,OK,Profitest Wechsel,Ada',
    '22,06.10.2026,"ALT 3216\nNEU BT Adapter S/N 3208",Neu,,2,Express,Ja,Nein,Falsch,01.01.2020,Falsch,,OK,BT Tausch,Ada',
    '23,07.10.2026,"ALT ---\nNEU Secutest PRO S/N HL7578850006",Geschlossen,Hoch,3,Samstag,Ja,Wahr,Wahr,07.10.2026 10:00,Falsch,09.10.2026,OK,Secutest,Ada',
    '24,08.10.2026,"ALT DPG-UX10G3-121\nNEU DPG-UX10G3-050",Neu,Normal,1,Standard,Ja,Nein,Wahr,,Falsch,,OK,Getac,Ada',
  ].join('\n');

  const result = parseSharePointReturnsCsv(csv);
  assert(result.rows.length === 4, 'comma-delimited CSV parses 4 rows');

  const r21 = result.rows.find((r) => r.externalRefId === '21')!;
  assert(
    r21.deviceOldType === 'Profitest MXtra IQ' &&
      r21.deviceOldSerial === 'ZG1710' &&
      r21.deviceNewSerial === 'HA0478',
    'row 21 Mxtra inherit',
    JSON.stringify(r21),
  );
  assert(r21.isLikelyTest === false, 'Profitest Betreff not a test row');
  assert(r21.mail1SentAt != null, 'Mail1 Wahr empty date → Erstellt fallback');
  assert(r21.mail3SentAt === null, 'Mail3 Falsch ignores stale 01.01.2020');

  const r22 = result.rows.find((r) => r.externalRefId === '22')!;
  assert(
    r22.deviceOldType === 'BT Adapter' &&
      r22.deviceOldSerial === '3216' &&
      r22.deviceNewSerial === '3208' &&
      r22.sla === 'Normal',
    'row 22 BT 4-digit + SLA default Normal',
    JSON.stringify(r22),
  );

  const r23 = result.rows.find((r) => r.externalRefId === '23')!;
  assert(
    r23.deviceOldSerial === null &&
      r23.deviceNewType === 'Secutest ST Pro' &&
      r23.returned === true &&
      r23.isLikelyTest === false,
    'row 23 --- / Secutest PRO / Secutest not test',
    JSON.stringify(r23),
  );

  const r24 = result.rows.find((r) => r.externalRefId === '24')!;
  assert(
    r24.deviceOldType === 'Getac Tablet (UX10)' &&
      r24.deviceNewSerial === 'DPG-UX10G3-050',
    'row 24 UX10 tags',
    JSON.stringify(r24),
  );

  assert(
    result.discoveredCatalogs.slas.includes('Normal') &&
      result.discoveredCatalogs.shipping_methods.includes('Express') &&
      !result.discoveredCatalogs.device_types.some(looksLikeSerial),
    'catalogs clean (no serials)',
  );
}

function looksLikeSerial(t: string): boolean {
  return /^(DPG-|BCST|[A-Z]{2}\d{4,})/i.test(t) && !/\s/.test(t) && t.length < 24 && !/[a-z]{3}/.test(t);
}

function main(): void {
  console.log('=== Hardware Returns SharePoint CSV Parser (Part 1) ===');
  testLocaleParsers();
  testDeviceSplits();
  testLikelyTestRows();
  testMailSentAtLogic();
  testMoreDeviceFixtures();
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
