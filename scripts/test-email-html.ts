/**
 * Unit tests: outbound Graph HTML payload + merge/SafeLinks sanitization.
 * Run: npx tsx scripts/test-email-html.ts
 */

import assert from 'node:assert/strict';
import {
  cleanEmailHtmlForStorage,
  formatMergeSourceBodyHtml,
  htmlToAuditPlainText,
  looksLikeHtml,
  prepareOutboundEmailHtml,
  stripBrokenCidRefs,
  unwrapOutlookSafeLinks,
} from '../src/lib/email-html-prepare.ts';
import { sanitizeInboundHtml } from '../src/lib/email-ingestion/sanitize-server.ts';
import {
  buildPortalInviteEmail,
  buildPortalPasswordResetEmail,
} from '../src/lib/client-portal/portal-auth-emails.ts';
import {
  buildReminderHtmlEmail,
  buildReminderTemplateVars,
} from '../src/lib/client-portal/hardware-returns-recipients.ts';
import { defaultHardwareReturnsConfig } from '../src/lib/client-portal/hardware-returns.ts';
import {
  buildSecondLevelAssignmentEmail,
  formatBerlinDateTime,
} from '../src/lib/client-portal/second-level-notify.ts';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err?.message || err}`);
  }
}

console.log('Email HTML prepare — unit tests');
console.log('================================\n');

console.log('[1] Outbound Graph HTML (no literal <p> escaping)');
check('detects Quill HTML', () => {
  assert.equal(looksLikeHtml('<p>Why</p>'), true);
  assert.equal(looksLikeHtml('plain line\nnext'), false);
});

check('HTML body keeps real tags (not &lt;p&gt;)', () => {
  const out = prepareOutboundEmailHtml('<p>Why <strong>now</strong>?</p>');
  assert.ok(out.includes('<p>'), `expected real <p>, got: ${out}`);
  assert.ok(out.includes('<strong>'), `expected <strong>, got: ${out}`);
  assert.ok(!out.includes('&lt;p&gt;'), `must not escape tags: ${out}`);
  assert.ok(!out.includes('&lt;strong&gt;'), `must not escape strong: ${out}`);
});

check('plain text becomes paragraphs with <br>', () => {
  const out = prepareOutboundEmailHtml('Hello\nWorld\n\nThanks');
  assert.ok(out.includes('<p>'), out);
  assert.ok(out.includes('<br'), out);
  assert.ok(out.includes('Hello'), out);
  assert.ok(!out.includes('<script'), out);
});

check('plain text with angle brackets is escaped (not treated as document HTML)', () => {
  const out = prepareOutboundEmailHtml('use <script> alert(1) </script>');
  assert.ok(out.includes('&lt;script&gt;') || !/<script\b/i.test(out), out);
  assert.ok(!/<script\b/i.test(out), out);
});

check('document HTML strips script but keeps paragraphs', () => {
  const out = prepareOutboundEmailHtml('<p>Safe</p><script>alert(1)</script>');
  assert.ok(out.includes('<p>'), out);
  assert.ok(out.includes('Safe'), out);
  assert.ok(!/<script\b/i.test(out), out);
  assert.ok(!out.includes('&lt;p&gt;'), out);
});

check('empty body yields empty string', () => {
  assert.equal(prepareOutboundEmailHtml('   '), '');
});

console.log('\n[2] Outlook SafeLinks unwrap + merge cleanup');
check('unwraps safelinks.protection.outlook.com', () => {
  const wrapped =
    'https://nam01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2Fpath%3Fq%3D1&data=05%7C00&sdata=abc&reserved=0';
  const out = unwrapOutlookSafeLinks(`Click <a href="${wrapped}">here</a>`);
  assert.ok(out.includes('https://example.com/path?q=1'), out);
  assert.ok(!/safelinks\.protection\.outlook\.com/i.test(out), out);
});

check('strip elementToProof / empty wrappers', () => {
  const dirty =
    '<div class="elementToProof"><div></div><p class="MsoNormal">Hello</p></div>';
  const out = cleanEmailHtmlForStorage(dirty);
  assert.ok(out.includes('Hello'), out);
  assert.ok(!/elementToProof/i.test(out), out);
});

check('strip unresolved cid: images', () => {
  const dirty = '<p>Hi</p><img src="cid:image001@01" alt="x" /><p>Bye</p>';
  const out = stripBrokenCidRefs(dirty);
  assert.ok(out.includes('Hi'), out);
  assert.ok(out.includes('Bye'), out);
  assert.ok(!/cid:/i.test(out), out);
});

check('preserves signature-logo cid for Graph inline attach', () => {
  const dirty =
    '<p>Hi</p><img src="cid:signature-logo" alt="" /><img src="cid:other@01" /><p>Bye</p>';
  const out = stripBrokenCidRefs(dirty);
  assert.ok(/cid:signature-logo/i.test(out), out);
  assert.ok(!/cid:other/i.test(out), out);
});

check('formatMergeSourceBodyHtml sanitizes HTML description', () => {
  const html = formatMergeSourceBodyHtml(
    '<div class="elementToProof"><p>Body <a href="https://nam.safelinks.protection.outlook.com/?url=https%3A%2F%2Fhubcom.de">x</a></p><img src="cid:abc" /></div>',
    'Merge subject',
  );
  assert.ok(html.includes('Betreff'), html);
  assert.ok(html.includes('Body'), html);
  assert.ok(html.includes('https://hubcom.de') || html.includes('hubcom.de'), html);
  assert.ok(!/cid:/i.test(html), html);
  assert.ok(!/elementToProof/i.test(html), html);
});

check('inbound sanitize strips XSS after SafeLinks clean', () => {
  const dirty =
    '<p>Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>' +
    `<a href="https://safelinks.protection.outlook.com/?url=https%3A%2F%2Fok.example">link</a>`;
  const out = sanitizeInboundHtml(dirty);
  assert.ok(!/<script/i.test(out), out);
  assert.ok(!/javascript:/i.test(out), out);
  assert.ok(/ok\.example/i.test(out) || /href="https:\/\/ok\.example"/i.test(out), out);
});

console.log('\n[3] Verlauf / audit plain-text (no raw tags)');
check('htmlToAuditPlainText strips tags and keeps line breaks', () => {
  const dirty =
    '<div class="elementToProof"><p>Zeile eins</p><div>Zeile zwei</div><ul><li>Punkt</li></ul>' +
    '<table><tr><td>A</td><td>B</td></tr></table>' +
    '<img src="cid:logo@01" />' +
    `<a href="https://nam.safelinks.protection.outlook.com/?url=https%3A%2F%2Fhubcom.de">Link</a></div>`;
  const out = htmlToAuditPlainText(dirty);
  assert.ok(out.includes('Zeile eins'), out);
  assert.ok(out.includes('Zeile zwei'), out);
  assert.ok(out.includes('Punkt'), out);
  assert.ok(!/</.test(out), `must not contain raw tags: ${out}`);
  assert.ok(!/cid:/i.test(out), out);
  assert.ok(!/elementToProof/i.test(out), out);
  assert.ok(!/safelinks/i.test(out), out);
  assert.ok(/\n/.test(out) || out.includes('Zeile'), out);
});

check('htmlToAuditPlainText handles already-escaped HTML notes', () => {
  const dirty = '&lt;div class="elementToProof"&gt;&lt;p&gt;Merged body&lt;/p&gt;&lt;/div&gt;';
  const out = htmlToAuditPlainText(dirty);
  assert.ok(out.includes('Merged body'), out);
  assert.ok(!/elementToProof/i.test(out), out);
  assert.ok(!/</.test(out), out);
});

console.log('\n[4] Portal invite vs password-reset HTML templates');
check('invite and reset use distinct subjects and copy', () => {
  const invite = buildPortalInviteEmail({
    recipientName: 'Anna Admin',
    organizationName: 'Acme GmbH',
    role: 'CLIENT_ADMIN',
    setupLink: 'https://app.example/login?setup=act-invite',
  });
  const reset = buildPortalPasswordResetEmail({
    recipientName: 'Anna Admin',
    organizationName: 'Acme GmbH',
    setupLink: 'https://app.example/login?setup=act-reset',
  });

  assert.equal(invite.kind, 'invite');
  assert.equal(reset.kind, 'reset');
  assert.notEqual(invite.subject, reset.subject);
  assert.equal(
    invite.subject,
    'Willkommen im Acme GmbH ServiceDesk — Konto aktivieren',
  );
  assert.equal(reset.subject, 'Passwort zurücksetzen — Acme GmbH ServiceDesk');
  assert.ok(
    invite.html.includes('Konto aktivieren &amp; Passwort festlegen') ||
      invite.html.includes('Konto aktivieren & Passwort festlegen'),
    invite.html,
  );
  assert.ok(reset.html.includes('Neues Passwort festlegen'), reset.html);
  assert.ok(invite.html.includes('Kunden-Administrator'), invite.html);
  assert.ok(
    invite.html.includes('Aus Sicherheitsgründen wird kein Passwort per E-Mail versendet.'),
    invite.html,
  );
  assert.ok(
    reset.html.includes('Falls Sie diese Anfrage nicht gestellt haben'),
    reset.html,
  );
});

check('portal auth emails are real HTML (no <pre>) and keep CTA href', () => {
  const invite = buildPortalInviteEmail({
    recipientName: 'Sam',
    organizationName: 'Org A',
    role: 'CLIENT_USER',
    setupLink: 'https://portal.example/login?setup=tok-1',
  });
  const prepared = prepareOutboundEmailHtml(invite.html);
  assert.ok(!/<pre\b/i.test(invite.html), 'invite must not wrap in <pre>');
  assert.ok(!/<pre\b/i.test(prepared), 'prepared invite must not contain <pre>');
  assert.ok(!invite.html.includes('&lt;table'), 'invite must not escape table tags');
  assert.ok(/<table\b/i.test(invite.html), invite.html);
  assert.ok(
    invite.html.includes('href="https://portal.example/login?setup=tok-1"'),
    invite.html,
  );
  assert.ok(invite.html.includes('Mitarbeiter'), invite.html);

  const reset = buildPortalPasswordResetEmail({
    recipientName: 'Sam',
    organizationName: 'Org A',
    setupLink: 'https://portal.example/login?setup=tok-2',
  });
  assert.ok(!/<pre\b/i.test(reset.html), 'reset must not wrap in <pre>');
  assert.ok(
    reset.html.includes('href="https://portal.example/login?setup=tok-2"'),
    reset.html,
  );
  // Mimic trySendTransactionalEmail(contentType: 'HTML') — body stays raw HTML.
  assert.equal(invite.html.includes('<pre'), false);
  assert.ok(looksLikeHtml(invite.html));
  assert.ok(looksLikeHtml(reset.html));
});

console.log('\n[5] Hardware-Rücklieferung reminder HTML (3 stages)');
check('all 3 reminder stages render Outlook-safe branded HTML', () => {
  const config = defaultHardwareReturnsConfig();
  const vars = buildReminderTemplateVars({
    ticket: {
      id: 'TKT-HW-1',
      customer_name: 'Max Mustermann',
      customer_email: 'max@dpg.test',
    },
    hardwareReturn: {
      id: 'hw',
      organization_id: 'org',
      ticket_id: null,
      return_number: 'RL-1001',
      subject: 'Hardware',
      employee_name: 'Max Mustermann',
      employee_email: 'max@dpg.test',
      assignee_name: 'Support',
      assignee_user_id: null,
      directory_user_id: null,
      status: 'open',
      description: null,
      activity_log: [],
      external_ref_id: '929',
      service_level: '2',
      sla: 'Normal',
      time_sl1_minutes: 0,
      time_sl2_minutes: 0,
      time_sl3_minutes: 0,
      exported: false,
      exported_at: null,
      request_type: null,
      device_details: 'Latitude 5540 ALT ABC / NEU DEF',
      device_old_type: null,
      device_old_serial: null,
      device_new_type: null,
      device_new_serial: null,
      employee_phone: null,
      employee_mobile: null,
      project_manager_name: null,
      project_manager_email: null,
      manager_name: null,
      manager_email: null,
      ceo_email_override: null,
      stage_recipients_override: null,
      solution_summary: null,
      shipping_method: null,
      shipping_reference: null,
      shipment_status: null,
      return_required: true,
      delivery_date: '2026-10-01',
      return_due_date: '2026-10-15',
      auto_reminder_enabled: true,
      mail1_scheduled_date: null,
      mail2_scheduled_date: null,
      mail3_scheduled_date: null,
      mail1_sent_at: null,
      mail1_sent_recipients: null,
      mail2_sent_at: null,
      mail2_sent_recipients: null,
      mail3_sent_at: null,
      mail3_sent_recipients: null,
      reminder_stages: [],
      reminder_count: 0,
      returned: false,
      returned_at: null,
      created_at: '',
      updated_at: '',
    },
    orgConfig: config,
    now: new Date('2026-10-20T12:00:00.000Z'),
  });

  for (const stage of [1, 2, 3, 4] as const) {
    const configured = config.stages[stage - 1]!;
    const built = buildReminderHtmlEmail({
      subject: configured.subjectTemplate,
      bodyTextOrHtml: configured.bodyTemplate,
      vars,
      stage,
    });
    const prepared = prepareOutboundEmailHtml(built.html);
    assert.ok(built.subject.length > 0, `stage ${stage} subject`);
    assert.ok(/<table\b/i.test(built.html), `stage ${stage} table layout`);
    assert.ok(!/<pre\b/i.test(built.html), `stage ${stage} no <pre>`);
    assert.ok(
      built.html.includes('RL-1001') || built.html.includes('929'),
      `stage ${stage} return number`,
    );
    assert.ok(built.html.includes('Max Mustermann'), `stage ${stage} employee`);
    assert.ok(built.html.includes('Latitude 5540'), `stage ${stage} device`);
    assert.ok(built.html.includes('2026-10-01') || built.html.includes('2026-10-15'), `stage ${stage} dates`);
    assert.ok(looksLikeHtml(prepared), `stage ${stage} prepared HTML`);
    assert.ok(!prepared.includes('&lt;table'), `stage ${stage} tags not escaped`);
  }
});

console.log('\n[6] 2nd-Level-Support assignment HTML notification');
check('renders metadata grid, Berlin time, escaped XSS, CTA', () => {
  const built = buildSecondLevelAssignmentEmail({
    portalTitle: 'DPG ServiceDesk',
    label: '2nd-Level-Support',
    ticketNumber: 'HC-4242',
    subject: 'VPN down <script>alert(1)</script>',
    priority: 'Dringend',
    priorityKey: 'urgent',
    status: 'In Bearbeitung',
    category: 'Netzwerk',
    requesterName: 'Max <img>',
    requesterEmail: 'max@dpg.test',
    assignedByName: 'Portal Admin',
    assignedAt: new Date('2026-11-26T16:05:00.000Z'),
    messageSnippet: 'Bitte prüfen: <b>tunnel</b> & "gateway"',
    ticketUrl: 'https://portal.example.test/portal/tickets/tkt-4242',
  });
  assert.ok(
    built.subject.includes('[2nd-Level-Support]') &&
      built.subject.includes('HC-4242') &&
      built.subject.includes('VPN down'),
    `subject: ${built.subject}`,
  );
  assert.ok(/<table\b/i.test(built.html), 'table-based layout');
  assert.ok(!/<pre\b/i.test(built.html), 'no <pre>');
  assert.ok(built.html.includes('DPG ServiceDesk'), 'portal branding title');
  assert.ok(built.html.includes('2nd-Level-Support Zuweisung'), 'badge');
  assert.ok(built.html.includes('#HC-4242') || built.html.includes('HC-4242'), 'ticket nr');
  assert.ok(built.html.includes('Dringend'), 'priority pill');
  assert.ok(built.html.includes('In Bearbeitung'), 'status');
  assert.ok(built.html.includes('Netzwerk'), 'category');
  assert.ok(built.html.includes('max@dpg.test'), 'requester email');
  assert.ok(built.html.includes('Portal Admin'), 'assigned by');
  assert.ok(
    built.html.includes('Ticket im Portal öffnen'),
    'primary CTA label',
  );
  assert.ok(
    built.html.includes('https://portal.example.test/portal/tickets/tkt-4242'),
    'CTA href',
  );
  assert.ok(!/<script\b/i.test(built.html), 'script tags stripped/escaped');
  assert.ok(built.html.includes('&lt;script&gt;') || !built.html.includes('<script>'), 'xss escaped in subject line body');
  assert.ok(built.html.includes('&lt;img&gt;') || !built.html.includes('<img>'), 'requester xss escaped');
  assert.ok(built.html.includes('&amp;') || built.html.includes('&quot;'), 'snippet entities escaped');
  const berlin = formatBerlinDateTime(new Date('2026-11-26T16:05:00.000Z'));
  assert.ok(/Uhr$/.test(berlin), `Berlin suffix: ${berlin}`);
  assert.ok(built.html.includes('Uhr'), 'email shows Berlin-formatted time');
  const prepared = prepareOutboundEmailHtml(built.html);
  assert.ok(looksLikeHtml(prepared), 'prepared HTML');
  assert.ok(!prepared.includes('&lt;table'), 'tags not double-escaped');
});

console.log('\n================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('OK: email HTML suite passed.\n');
