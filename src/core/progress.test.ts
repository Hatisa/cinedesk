import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWatchTime, watchProgress } from './progress.ts';

test('总时长未知仍显示实际观看时间', () => {
  const p = watchProgress({ position: 508, duration: 0 });
  assert.equal(p.percent, null);
  assert.equal(p.summary, '已观看 8:28');
});

test('有总时长时显示百分比和剩余时间', () => {
  const p = watchProgress({ position: 600, duration: 3600 });
  assert.equal(p.percent, 16);
  assert.equal(p.summary, '已看 10:00 / 1:00:00 · 16% · 剩余 50:00');
});

test('进度展示处理异常值与跨小时时间', () => {
  assert.equal(formatWatchTime(3661), '1:01:01');
  assert.equal(watchProgress({ position: 5000, duration: 3600 }).percent, 100);
  assert.equal(watchProgress({ position: NaN, duration: 0 }).summary, '尚未播放');
});
