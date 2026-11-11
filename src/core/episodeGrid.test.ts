import test from 'node:test';
import assert from 'node:assert/strict';
import { episodeColumnCount } from './episodeGrid.ts';

/** 12.5px 字号下中文约 12.5px、数字约 7.2px */
const text = (s: string) => [...s].reduce((sum, ch) => sum + (/[\u4e00-\u9fa5，：、]/.test(ch) ? 12.5 : 7.2), 0);

const W = 358; // 390 屏宽 - 页边距 16×2

test('短标题（第01集）保持 5 列', () => {
  assert.equal(episodeColumnCount(Array.from({ length: 36 }, () => text('第01集')), W), 5);
});

test('综艺的 11 字标题降到 3 列，且一行放得下', () => {
  const widths = Array.from({ length: 20 }, () => text('第20260626期上'));
  const columns = episodeColumnCount(widths, W);
  assert.equal(columns, 3);
  const inner = (W - 8 * (columns - 1)) / columns - 16;
  assert.ok(widths[0] <= inner, '标题应该能单行显示');
});

test('少数超长标题不把整页压成 2 列', () => {
  const widths = Array.from({ length: 100 }, () => text('第01集'));
  widths[3] = text('特别篇：主创访谈完整版回顾');
  assert.equal(episodeColumnCount(widths, W), 5);
});

test('全部是长标题时退到 2 列，两行内放得下', () => {
  const widths = Array.from({ length: 40 }, () => text('特别篇：主创访谈完整版回顾'));
  const columns = episodeColumnCount(widths, W);
  assert.equal(columns, 2);
  const inner = (W - 8) / 2 - 16;
  assert.ok(widths[0] / inner <= 2, '最坏也能在两行内显示完整');
});

test('列数随容器宽度变化（320 / 430 屏）', () => {
  const widths = Array.from({ length: 36 }, () => text('第01集'));
  assert.equal(episodeColumnCount(widths, 288), 4);
  assert.equal(episodeColumnCount(widths, 398), 5);
});

test('空列表或尚未测量时不返回列数', () => {
  assert.equal(episodeColumnCount([], W), 0);
  assert.equal(episodeColumnCount([39.4], 0), 0);
});
