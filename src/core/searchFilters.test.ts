import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterSearchItems, matchesSearchFilters, searchYearOptions } from './searchFilters.ts';
import type { AggregatedItem, VodItem } from './types.ts';

const vod = (patch: Partial<VodItem> = {}): VodItem => ({
  sourceKey: 'test', sourceName: '测试', vodId: '1', name: '影片', pic: '', remarks: '',
  year: '2026', area: '中国大陆', typeName: '动作,喜剧', score: 0, scoreSource: null,
  actor: '', director: '', content: '', lines: [], shortDrama: false, ...patch,
});
const aggregate = (variants: VodItem[]): AggregatedItem => ({
  key: variants[0].name, name: variants[0].name, pic: '', remarks: '', year: variants[0].year,
  typeName: variants[0].typeName, score: 0, scoreSource: null, shortDrama: false, variants,
});
const now = new Date(2026, 9, 28);

test('类型、地区和时间在同一来源副本中组合匹配', () => {
  const hit = aggregate([vod()]);
  const wrong = aggregate([vod({ area: '美国' }), vod({ typeName: '爱情', area: '内地' })]);
  const filters = { type: '喜剧', area: '内地', year: '2026' };
  assert.deepEqual(filterSearchItems([hit, wrong], filters, now), [hit]);
  assert.equal(matchesSearchFilters(vod(), { type: '动作', area: '美国', year: '2026' }, now), false);
});

test('地区兼容常见别名，缺失元数据不会误命中', () => {
  for (const area of ['大陆', '中国内地', '中国']) {
    assert.equal(matchesSearchFilters(vod({ area }), { type: '', area: '内地', year: '' }), true);
  }
  assert.equal(matchesSearchFilters(vod({ area: '中国香港' }), { type: '', area: '中国香港', year: '' }), true);
  assert.equal(matchesSearchFilters(vod({ area: '英国' }), { type: '', area: '欧洲', year: '' }), true);
  assert.equal(matchesSearchFilters(vod({ area: '' }), { type: '', area: '内地', year: '' }), false);
});

test('时间选项随真实年份更新，覆盖即将上映和更早', () => {
  assert.deepEqual(searchYearOptions(now), ['2026', '2025', '2024', '2023', '2022', '2021']);
  assert.deepEqual(searchYearOptions(new Date(2027, 0, 1)), ['2027', '2026', '2025', '2024', '2023', '2022']);
  assert.equal(matchesSearchFilters(vod({ year: '2027' }), { type: '', area: '', year: 'upcoming' }, now), true);
  assert.equal(matchesSearchFilters(vod({ year: '2026' }), { type: '', area: '', year: 'upcoming' }, now), false);
  assert.equal(matchesSearchFilters(vod({ year: '2020' }), { type: '', area: '', year: 'older' }, now), true);
  assert.equal(matchesSearchFilters(vod({ year: '2021' }), { type: '', area: '', year: 'older' }, now), false);
});
