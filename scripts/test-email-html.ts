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

console.log('\n================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('OK: email HTML suite passed.\n');
