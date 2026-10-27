import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeItems, sortSearchItems } from './aggregate.ts';
import { cleanName, cleanPeople, toVodItem } from './cms.ts';
import { HealthStore } from './health.ts';
import type { AggregatedItem, RawVod, SourceConfig } from './types.ts';
import { findSavedVariant, matchesSavedWork, upgradeSavedWorkKey, workKeyFor } from './work.ts';

const source: SourceConfig = { key: 'fixture', name: '测试源', api: 'https://example.test/api', enabled: true, builtin: false };
const raw = (id: number, name: string, year: string, score = '8'): RawVod => ({
  vod_id: id, vod_name: name, vod_year: year, vod_douban_score: score,
  vod_class: '剧情', vod_play_from: '默认', vod_play_url: `正片$https://media.test/${id}.m3u8`,
});
const outcome = (items: RawVod[]) => ({ source, items: items.map((r) => toVodItem(r, source)!).filter(Boolean), status: { key: source.key, name: source.name, state: 'ok' as const, count: items.length, ms: 0 } });
const agg = (name: string, score: number, shortDrama = false, scoreSource: 'douban' | 'site' = 'douban'): AggregatedItem => ({ key: name, name, year: '', pic: '', remarks: '', typeName: '', score, scoreSource, shortDrama, variants: [] });

test('同名不同年份是两个独立作品，评分和播放地址不会串用', () => {
  const items = mergeItems([outcome([raw(1, '同名作品', '2010', '7.1'), raw(2, '同名作品', '2024', '8.8')])], new HealthStore());
  assert.equal(items.length, 2);
  assert.notEqual(items[0].key, items[1].key);
  assert.deepEqual(items.map((x) => x.score), [7.1, 8.8]);
});

test('同源不同ID不能因同名同年而静默丢片', () => {
  const items = mergeItems([outcome([raw(1, '同名作品', '2024'), raw(2, '同名作品', '2024')])], new HealthStore());
  assert.equal(items.length, 2);
  assert.notEqual(items[0].key, items[1].key);
});

test('跨来源同版正常合并，缺年份与有年份可以兼容', () => {
  const health = new HealthStore();
  const a = toVodItem(raw(1, '庆余年 第二季', '2024'), source)!;
  const b = toVodItem(raw(99, '庆余年第二季', ''), { ...source, key: 'other' })!;
  const items = mergeItems([{ source, items: [a], status: { key: source.key, name: source.name, state: 'ok', count: 1, ms: 0 } }, { source, items: [b], status: { key: 'other', name: 'other', state: 'ok', count: 1, ms: 0 } }], health);
  assert.equal(items.length, 1);
  assert.equal(items[0].variants.length, 2);
});

test('精确片名优先，短剧及站内评分不会抢占普通作品层级', () => {
  const items = [agg('庆余年之风起沧州', 9, true), agg('英雄无泪修庆版', 8.2), agg('庆余年', 7.9)];
  assert.equal(sortSearchItems(items, '庆余年')[0].name, '庆余年');
  assert.equal(sortSearchItems(items, '庆余年').at(-1)?.shortDrama, true);
  assert.equal(items[0].scoreSource, 'douban');
});

test('豆瓣分保持原值，站内分独立标记且不再折算', () => {
  const item = toVodItem({ ...raw(1, '测试', '2024'), vod_douban_score: undefined, vod_score: '10' }, source)!;
  assert.equal(item.score, 10);
  assert.equal(item.scoreSource, 'site');
  assert.equal(toVodItem(raw(2, '豆瓣测试', '2024', '8.8'), source)?.score, 8.8);
});

test('收藏/历史精确匹配版本，并兼容旧版片名键', () => {
  const items = mergeItems([outcome([raw(1, '同名作品', '2010'), raw(2, '同名作品', '2024')])], new HealthStore());
  const saved = { key: '同名作品', name: '同名作品', sourceKey: source.key, vodId: '2' };
  assert.equal(matchesSavedWork(items[0], saved), false);
  assert.equal(matchesSavedWork(items[1], saved), true);
  assert.equal(findSavedVariant(items[1], saved), 0);
  assert.equal(workKeyFor({ name: '同名作品', year: '2024' }), items[1].key);
  assert.equal(matchesSavedWork(items[1], { ...saved, vodId: '999' }), false);
  assert.equal(matchesSavedWork(items[0], { ...saved, vodId: '1' }), true);
  const legacy = { key: '同名作品', name: '同名作品', year: '2024' };
  assert.equal(upgradeSavedWorkKey(legacy).key, items[1].key);
  const current = { ...legacy, key: items[1].key };
  assert.equal(upgradeSavedWorkKey(current), current);
});

test('资源站文本清理别名分隔符及首尾逗号', () => {
  assert.equal(cleanName('片名$别名'), '片名 / 别名');
  assert.equal(cleanPeople('张若昀,李沁,'), '张若昀,李沁');
});
