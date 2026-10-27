import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveSelection, nextPlayable, playPath, selectionFor } from './playback.ts';
import type { AggregatedItem, VodItem } from './types.ts';
const variant = (sourceKey: string, vodId: string, lineCounts: number[]): VodItem => ({ sourceKey, vodId, sourceName: sourceKey, name: '测试作品', year: '2024', area: '', actor: '', director: '', content: '', pic: '', remarks: '', typeName: '剧情', score: 8, scoreSource: 'douban', shortDrama: false, lines: lineCounts.map((count, i) => ({ from: `线路${i}`, name: `线路${i}`, direct: true, episodes: Array.from({ length: count }, (_, index) => ({ index, name: `第${index + 1}集`, url: `https://media.test/${vodId}/${i}/${index}.mp4` })) })) });
const item: AggregatedItem = { key: '测试作品~2024', name: '测试作品', year: '2024', pic: '', remarks: '', typeName: '剧情', score: 8, scoreSource: 'douban', shortDrama: false, variants: [variant('a', '1', [40, 12]), variant('b', '2', [30])] };
test('路由精确区分来源、同源线路和集数', () => {
  assert.deepEqual(selectionFor(item, { source: 'a', vodId: '1', line: 1, ep: 11 }), { variantIdx: 0, lineIdx: 1, epIdx: 11 });
  assert.deepEqual(selectionFor(item, { source: 'a', vodId: '1', line: 0, ep: 99 }), { variantIdx: 0, lineIdx: 0, epIdx: 39 });
  assert.match(playPath(item, { variantIdx: 1, lineIdx: 0, epIdx: 11 }), /source=b&vod=2&line=0&ep=11/);
});
test('手动和自动换源保留集号，集数不足才夹紧', () => {
  assert.deepEqual(moveSelection(item, { variantIdx: 0, lineIdx: 0, epIdx: 11 }, { variantIdx: 1 }), { variantIdx: 1, lineIdx: 0, epIdx: 11 });
  assert.deepEqual(moveSelection(item, { variantIdx: 0, lineIdx: 0, epIdx: 35 }, { variantIdx: 1 }), { variantIdx: 1, lineIdx: 0, epIdx: 29 });
});
test('失败优先换同源线路，再换其他来源', () => {
  assert.deepEqual(nextPlayable(item, { variantIdx: 0, lineIdx: 0, epIdx: 11 }, new Set()), { variantIdx: 0, lineIdx: 1, epIdx: 11 });
  assert.deepEqual(nextPlayable(item, { variantIdx: 0, lineIdx: 1, epIdx: 11 }, new Set()), { variantIdx: 1, lineIdx: 0, epIdx: 11 });
  assert.equal(nextPlayable(item, { variantIdx: 0, lineIdx: 0, epIdx: 11 }, new Set(['a:1:1', 'b:2:0'])), null);
});
