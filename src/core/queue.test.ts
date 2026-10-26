/**
 * 缓存任务队列的行为测试。
 *
 * 锁住三件肉眼看不出来的事：
 *   1) 集与集之间串行（不能同时下多集，否则源站会被打限流）
 *   2) 单集失败不阻塞后续（用户只需重试失败那集）
 *   3) 取消后迟到的进度回调不会把状态改回去
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskQueue } from './queue.ts';

const tick = () => new Promise((r) => setTimeout(r, 0));

test('集与集之间串行：同一时刻只有一个任务在跑', async () => {
  let running = 0;
  let maxRunning = 0;
  const order: string[] = [];

  const q = new TaskQueue<string>({
    run: async (p) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      order.push(`start:${p}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end:${p}`);
      running -= 1;
    },
  });

  q.add('a', 'A');
  q.add('b', 'B');
  q.add('c', 'C');
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(maxRunning, 1, '串行执行，并发数应始终为 1');
  assert.deepEqual(order, ['start:A', 'end:A', 'start:B', 'end:B', 'start:C', 'end:C']);
  assert.deepEqual(
    q.snapshot().map((t) => t.status),
    ['done', 'done', 'done'],
  );
});

test('单集失败不阻塞后续任务，失败信息留在该任务上', async () => {
  const q = new TaskQueue<string>({
    run: async (p) => {
      if (p === 'B') throw new Error('分片下载失败：HTTP 502');
    },
  });

  q.add('a', 'A');
  q.add('b', 'B');
  q.add('c', 'C');
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(q.find('a')?.status, 'done');
  assert.equal(q.find('b')?.status, 'failed');
  assert.match(q.find('b')?.error ?? '', /HTTP 502/);
  assert.equal(q.find('c')?.status, 'done', '后面的任务应继续执行');
});

test('取消进行中的任务：状态为 cancelled，run 收到 abort 信号', async () => {
  let sawAbort = false;
  const q = new TaskQueue<string>({
    run: (_p, _prog, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          sawAbort = true;
          reject(new DOMException('下载已取消', 'AbortError'));
        });
      }),
  });

  q.add('a', 'A');
  await tick();
  assert.equal(q.find('a')?.status, 'running');

  q.cancel('a');
  await tick();

  assert.equal(sawAbort, true);
  assert.equal(q.find('a')?.status, 'cancelled');
});

test('取消等待中的任务：不会被执行', async () => {
  const ran: string[] = [];
  const q = new TaskQueue<string>({
    run: async (p) => {
      ran.push(p);
      await new Promise((r) => setTimeout(r, 5));
    },
  });

  q.add('a', 'A');
  q.add('b', 'B');
  await tick();
  q.cancel('b');
  await new Promise((r) => setTimeout(r, 30));

  assert.deepEqual(ran, ['A'], '被取消的等待任务不应执行');
  assert.equal(q.find('b')?.status, 'cancelled');
});

test('取消后迟到的进度回调不改回状态', async () => {
  /*
   * 用对象承载回调：变量只在异步回调里被赋值，直接写成变量的话
   * TS 会在调用点把它收窄成 null，误报「不可调用」。
   */
  const box: { push: ((d: number, t: number, b: number) => void) | null } = { push: null };
  const q = new TaskQueue<string>({
    run: (_p, progress) => {
      box.push = progress;
      return new Promise(() => {
        /* 永不结束，模拟长下载 */
      });
    },
  });

  q.add('a', 'A');
  await tick();
  q.cancel('a');
  assert.equal(q.find('a')?.status, 'cancelled');

  // 下载器可能还会回调一次进度，此时必须被丢弃
  box.push?.(3, 10, 300);
  assert.equal(q.find('a')?.status, 'cancelled');
  assert.equal(q.find('a')?.done, 0, '取消后进度不应再变化');
});

test('同一 id 重复入队只保留一条；结束后可重新入队（重试）', async () => {
  const ran: string[] = [];
  const q = new TaskQueue<string>({
    run: async (p) => {
      ran.push(p);
    },
  });

  q.add('a', 'A');
  q.add('a', 'A');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(ran, ['A'], '重复入队不应重复执行');
  assert.equal(q.snapshot().length, 1);

  q.add('a', 'A');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(ran, ['A', 'A'], '已结束的任务可重新入队');
});

test('has 只对等待中/进行中的任务为真', async () => {
  const q = new TaskQueue<string>({ run: async () => undefined });
  q.add('a', 'A');
  assert.equal(q.has('a'), true);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(q.has('a'), false, '已完成的任务不应算作进行中');
});
