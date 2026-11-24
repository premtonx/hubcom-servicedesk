/**
 * Ticket sidebar favorites dedupe + collapse defaults.
 * Run: npx tsx scripts/test-tickets-sidebar-favorites.ts
 */

import assert from 'node:assert/strict';
import {
  COMPACT_COLLAPSE_SECTION_IDS,
  COMPACT_PRIMARY_VIEWS,
  COMPACT_SIDEBAR_SECTION,
  COMPACT_STATUS_VIEWS,
  COMPACT_URGENCY_VIEWS,
} from '../src/components/tickets/ticketsSidebarConfig.ts';
import {
  DEFAULT_COLLAPSED_GROUPS,
  DEFAULT_FAVORITE_VIEW_IDS,
  excludeFavoritedViews,
  isViewFavorited,
} from '../src/lib/ticketsSidebarPreferences.ts';

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

console.log('Tickets sidebar favorites & collapse — unit tests');
console.log('=================================================\n');

check('default favorites are Offen + Mir zugewiesen by view id', () => {
  assert.deepEqual(DEFAULT_FAVORITE_VIEW_IDS, ['assigned_me', 'status_open']);
});

check('excludeFavoritedViews removes only matching view ids', () => {
  const favorites = ['assigned_me', 'status_open'];
  const primary = excludeFavoritedViews(COMPACT_PRIMARY_VIEWS, favorites);
  assert.deepEqual(
    primary.map((i) => i.id),
    ['unassigned', 'team_all_open'],
  );
  const status = excludeFavoritedViews(COMPACT_STATUS_VIEWS, favorites);
  assert.deepEqual(
    status.map((i) => i.id),
    ['status_pending'],
  );
  // Urgency untouched — no overlapping ids
  assert.equal(
    excludeFavoritedViews(COMPACT_URGENCY_VIEWS, favorites).length,
    COMPACT_URGENCY_VIEWS.length,
  );
});

check('dedupe is by id, not by similar labels', () => {
  // status_open ("Offen") vs team_all_open ("All tickets") — distinct ids
  const filtered = excludeFavoritedViews(COMPACT_PRIMARY_VIEWS, ['status_open']);
  assert.ok(filtered.some((i) => i.id === 'team_all_open'));
  assert.ok(filtered.some((i) => i.id === 'assigned_me'));
  assert.ok(!filtered.some((i) => i.id === 'status_open'));
});

check('unfavoriting restores original section entry', () => {
  const withFav = excludeFavoritedViews(COMPACT_STATUS_VIEWS, ['status_open']);
  assert.deepEqual(
    withFav.map((i) => i.id),
    ['status_pending'],
  );
  const withoutFav = excludeFavoritedViews(COMPACT_STATUS_VIEWS, []);
  assert.deepEqual(
    withoutFav.map((i) => i.id),
    ['status_open', 'status_pending'],
  );
});

check('isViewFavorited normalizes legacy German slugs', () => {
  assert.equal(isViewFavorited('offen', ['status_open']), true);
  assert.equal(isViewFavorited('mir-zugewiesen', ['assigned_me']), true);
  assert.equal(isViewFavorited('unassigned', ['assigned_me']), false);
});

check('default collapse: Favoriten open; other compact sections collapsed', () => {
  assert.equal(DEFAULT_COLLAPSED_GROUPS.favorites, false);
  assert.equal(DEFAULT_COLLAPSED_GROUPS.primaryViews, true);
  assert.equal(DEFAULT_COLLAPSED_GROUPS.urgency, true);
  assert.equal(DEFAULT_COLLAPSED_GROUPS.statusQueues, true);
  assert.equal(DEFAULT_COLLAPSED_GROUPS.kunden, true);
});

check('compact collapse section ids cover Favoriten + four collapsed groups', () => {
  assert.deepEqual(COMPACT_COLLAPSE_SECTION_IDS, [
    COMPACT_SIDEBAR_SECTION.favorites,
    COMPACT_SIDEBAR_SECTION.primaryViews,
    COMPACT_SIDEBAR_SECTION.urgency,
    COMPACT_SIDEBAR_SECTION.statusQueues,
    COMPACT_SIDEBAR_SECTION.kunden,
  ]);
});

check('toggling collapse state does not require clearing favorites', () => {
  // Pure state model: collapse map is independent of favoriteViewIds
  const collapsed = { ...DEFAULT_COLLAPSED_GROUPS, primaryViews: false };
  const favorites = [...DEFAULT_FAVORITE_VIEW_IDS];
  assert.equal(collapsed.primaryViews, false);
  assert.deepEqual(favorites, ['assigned_me', 'status_open']);
  const stillHidden = excludeFavoritedViews(COMPACT_PRIMARY_VIEWS, favorites);
  assert.ok(!stillHidden.some((i) => i.id === 'assigned_me'));
});

check('customer org ids are never treated as view favorites', () => {
  const orgLike = [{ id: 'org-dpg' }, { id: 'assigned_me' }];
  const filtered = excludeFavoritedViews(orgLike, ['assigned_me']);
  assert.deepEqual(
    filtered.map((i) => i.id),
    ['org-dpg'],
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
