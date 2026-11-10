import assert from 'node:assert/strict';
import test from 'node:test';
import { groupSeries, isDerivative, searchSuggestions } from './searchPresentation.ts';
import type { AggregatedItem } from './types.ts';

const item = (name: string, key = name): AggregatedItem => ({ key, name, pic: '', remarks: '', year: '', typeName: '剧情', score: 0, scoreSource: null, shortDrama: false, variants: [] });

test('识别衍生视频但保留正常片名', () => {
  assert.equal(isDerivative(item('庆余年[电影解说]')), true);
  assert.equal(isDerivative(item('解说大会')), true);
  assert.equal(isDerivative(item('庆余年第二季')), false);
});

test('折叠同系列季与特别篇，不合并相似但不同的作品', () => {
  const result = groupSeries([item('庆余年第一季', '1'), item('庆余年第二季', '2'), item('庆余年 第一季 特别版', '3'), item('庆余年电影版')]);
  assert.equal(result.length, 2);
  assert.equal(result[0].kind, 'series');
  if (result[0].kind === 'series') assert.deepEqual(result[0].items.map((i) => i.key), ['1', '2', '3']);
  assert.equal(groupSeries([item('庆余年第一季')]).length, 1);
});

test('系列默认展示最新季，第三季不会被折叠隐藏', () => {
  const third = { ...item('喜剧之王单口季第三季', '3'), year: '2026' };
  const second = { ...item('喜剧之王单口季第二季', '2'), year: '2025' };
  const result = groupSeries([second, third]);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'series');
  if (result[0].kind === 'series') assert.deepEqual(result[0].items.map((i) => i.key), ['3', '2']);
});

test('空结果建议去重且排除当前关键词', () => {
  assert.deepEqual(searchSuggestions('庆余年', ['庆余年', '庆余年2'], ['庆余年2', '流浪地球']), ['庆余年2', '流浪地球']);
});
