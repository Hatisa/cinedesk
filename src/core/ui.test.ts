import test from 'node:test';
import assert from 'node:assert/strict';
import { goBackOr, onTabReset, emitTabReset } from './ui.ts';

/** 浏览器环境最小替身：只需要 history.state 与事件总线 */
class FakeWindow extends EventTarget {
  history = { state: {} as { idx?: number } };
}

const fake = new FakeWindow();
(globalThis as { window?: unknown }).window = fake;

const calls: unknown[][] = [];
const navigate = ((to: number | string, options?: { replace?: boolean }) => {
  calls.push([to, options]);
}) as Parameters<typeof goBackOr>[0];

test('有历史时返回上一页', () => {
  calls.length = 0;
  fake.history.state = { idx: 3 };
  goBackOr(navigate);
  assert.deepEqual(calls, [[-1, undefined]]);
});

test('没有历史时回到首页，而不是退到空白页', () => {
  calls.length = 0;
  fake.history.state = { idx: 0 };
  goBackOr(navigate);
  assert.deepEqual(calls, [['/', { replace: true }]]);
});

test('history.state 缺失时同样走兜底页', () => {
  calls.length = 0;
  fake.history.state = {};
  goBackOr(navigate, '/favorites');
  assert.deepEqual(calls, [['/favorites', { replace: true }]]);
});

test('底部标签重复点击事件能带上路径', () => {
  const seen: string[] = [];
  const off = onTabReset((path) => seen.push(path));
  emitTabReset('/');
  off();
  emitTabReset('/settings');
  assert.deepEqual(seen, ['/']);
});
