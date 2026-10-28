import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearchSnapshot, SEARCH_ITEM_MAX } from './searchSnapshot.ts';

const now = 100000000;
const snapshot = (savedAt = now) => ({ keyword: '测试', items: Array.from({ length: 80 }, () => ({})), statuses: [], totalMs: 123, savedAt, scrollY: 1500 });
test('搜索快照恢复限制数量与滚动位置', () => {
  assert.equal(normalizeSearchSnapshot(snapshot(), now)?.items.length, SEARCH_ITEM_MAX);
  assert.equal(normalizeSearchSnapshot(snapshot(), now)?.scrollY, 1500);
  assert.deepEqual(normalizeSearchSnapshot({ ...snapshot(), filters: { type: '喜剧', area: '内地', year: '2026' } }, now)?.filters, { type: '喜剧', area: '内地', year: '2026' });
  assert.deepEqual(normalizeSearchSnapshot({ ...snapshot(), filters: { type: 7, area: '', year: 'invalid' } }, now)?.filters, { type: '', area: '', year: '' });
});
test('过期、未来或缺少时间戳的快照不恢复', () => {
  assert.equal(normalizeSearchSnapshot(snapshot(now - 25 * 60 * 60 * 1000), now), null);
  assert.equal(normalizeSearchSnapshot(snapshot(now + 120000), now), null);
  assert.equal(normalizeSearchSnapshot({ keyword: '测试', items: [], statuses: [] }, now), null);
  assert.equal(normalizeSearchSnapshot(null, now), null);
});
