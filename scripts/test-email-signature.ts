/**
 * Unit tests: signature placeholders, empty-field collapse, Graph inline logo.
 * Run: npx tsx scripts/test-email-signature.ts
 */

import assert from 'node:assert/strict';
import {
  DEFAULT_HUBCOM_SIGNATURE_HTML,
  SIGNATURE_LOGO_CID,
  buildSignatureInlineAttachment,
  isSignatureEnabled,
  renderSignatureHtml,
} from '../src/lib/email-signature.ts';
import { appendSignatureToOutboundBody } from '../src/lib/email-signature-dispatch.ts';

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

console.log('Email Signature System — unit tests');
console.log('====================================\n');

const sampleLogo =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

console.log('[1] Placeholder rendering');
check('renders agent/org/ticket placeholders', () => {
  const html = renderSignatureHtml({
    channel: {
      signature_enabled: true,
      signature_html: DEFAULT_HUBCOM_SIGNATURE_HTML,
      signature_logo_data: sampleLogo,
      signature_logo_mime: 'image/png',
    },
    agent: {
      name: 'Anna Agent',
      title: 'IT-Systemengineer',
      phone: '+49 6201 39093-30',
      email: 'anna@hubcom.de',
    },
    ticket: { number: 'T-ABCDEF12' },
    organization: { name: 'Hubcom GmbH' },
    forPreview: false,
  });
  assert.ok(html.includes('Anna Agent'), html);
  assert.ok(html.includes('IT-Systemengineer'), html);
  assert.ok(html.includes('+49 6201 39093-30'), html);
  assert.ok(html.includes('anna@hubcom.de'), html);
  assert.ok(html.includes('Hubcom GmbH'), html);
  assert.ok(html.includes('T-ABCDEF12'), html);
  assert.ok(html.includes(`cid:${SIGNATURE_LOGO_CID}`), html);
});

check('collapses empty title/phone blocks', () => {
  const html = renderSignatureHtml({
    channel: {
      signature_enabled: true,
      signature_html: DEFAULT_HUBCOM_SIGNATURE_HTML,
    },
    agent: {
      name: 'Bob',
      title: '',
      phone: null,
      email: 'bob@hubcom.de',
    },
    organization: { name: 'Acme' },
    forPreview: true,
  });
  assert.ok(html.includes('Bob'), html);
  assert.ok(!/IT-Systemengineer/i.test(html), html);
  assert.ok(!/\+49/.test(html), html);
  assert.ok(html.includes('bob@hubcom.de'), html);
});

console.log('\n[2] Enabled / disabled');
check('disabled when signature_enabled=false', () => {
  assert.equal(
    isSignatureEnabled({ signature_enabled: false, signature_html: '<p>x</p>' }),
    false,
  );
});
check('enabled when signature_enabled=true even without custom html', () => {
  assert.equal(isSignatureEnabled({ signature_enabled: true }), true);
});

console.log('\n[3] Graph inline attachment');
check('builds isInline fileAttachment with contentId', () => {
  const att = buildSignatureInlineAttachment({
    signature_logo_data: sampleLogo,
    signature_logo_mime: 'image/png',
  });
  assert.ok(att, 'attachment expected');
  assert.equal(att!['@odata.type'], '#microsoft.graph.fileAttachment');
  assert.equal(att!.isInline, true);
  assert.equal(att!.contentId, SIGNATURE_LOGO_CID);
  assert.equal(att!.contentType, 'image/png');
  assert.ok(att!.contentBytes.length > 10);
});

check('appendSignatureToOutboundBody keeps history body separate', () => {
  const { html, inlineAttachment } = appendSignatureToOutboundBody({
    body: '<p>Why now?</p>',
    channel: {
      signature_enabled: true,
      signature_html: '<div>{{agent.name}}</div>{{channel.logo}}',
      signature_logo_data: sampleLogo,
      signature_logo_mime: 'image/png',
    },
    agent: { name: 'Carla', email: 'c@hubcom.de' },
    ticket: { id: 'abc12345' },
    organization: { name: 'Hubcom GmbH' },
    appendSignature: true,
  });
  assert.ok(html.includes('Why now?'), html);
  assert.ok(html.includes('Carla'), html);
  assert.ok(html.includes(`cid:${SIGNATURE_LOGO_CID}`), html);
  assert.ok(inlineAttachment?.isInline === true);
  assert.ok(!html.includes('&lt;p&gt;'), 'must not escape Quill HTML');
});

check('appendSignature=false leaves body without signature', () => {
  const { html, inlineAttachment } = appendSignatureToOutboundBody({
    body: '<p>Internal only</p>',
    channel: {
      signature_enabled: true,
      signature_html: '<div>SIG</div>',
    },
    agent: { name: 'X' },
    appendSignature: false,
  });
  assert.ok(html.includes('Internal only'), html);
  assert.ok(!html.includes('SIG'), html);
  assert.equal(inlineAttachment, null);
});

console.log('\n====================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('OK: email signature suite passed.\n');
