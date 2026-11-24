/**
 * Dashboard hero banner validation + layout constant checks.
 * Usage: npx tsx scripts/test-dashboard-banner.ts
 */

import {
  DASHBOARD_BANNER_MAX_BYTES,
  parseAndValidateDashboardBannerDataUrl,
} from '../src/lib/dashboard-banner.js';

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

console.log('\n1) Banner MIME / size policy');
{
  const pngTiny =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const ok = parseAndValidateDashboardBannerDataUrl(pngTiny);
  assert(ok.ok === true, 'tiny PNG accepted');

  const svg = 'data:image/svg+xml;base64,PHN2Zy8+';
  assert(parseAndValidateDashboardBannerDataUrl(svg).ok === false, 'SVG rejected');

  assert(parseAndValidateDashboardBannerDataUrl('').ok === false, 'empty rejected');
  assert(
    parseAndValidateDashboardBannerDataUrl('https://example.com/x.jpg').ok === false,
    'external URL rejected (must be data URL)',
  );
  assert(DASHBOARD_BANNER_MAX_BYTES === 2 * 1024 * 1024, 'max size is 2 MB');
}

console.log('\n2) Oversized payload rejected');
{
  // ~2.1 MB of base64-ish payload
  const big = `data:image/png;base64,${'A'.repeat(Math.ceil((2.1 * 1024 * 1024 * 4) / 3))}`;
  const res = parseAndValidateDashboardBannerDataUrl(big);
  assert(res.ok === false, 'oversize PNG rejected');
}

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
