/**
 * 源健康度。
 *
 * 实测证明「没有任何一个源能长期稳定」——同一批源里约 1/3 在任意时刻是挂的，
 * 而且挂掉/恢复随时间变化。所以稳定性不来自「选对源」，而来自
 * 「记住每个源的真实表现，并把好源排到前面、坏源自动沉底」。
 *
 * 评分同时考虑成功率与响应速度，失败会带来惩罚而非直接拉黑，
 * 这样恢复的源能在几轮之后重新被优先使用。
 */
import type { HealthRecord } from './types.ts';

const EMPTY: HealthRecord = {
  lastOk: 0,
  lastFail: 0,
  okStreak: 0,
  failStreak: 0,
  avgMs: 0,
  okTotal: 0,
  failTotal: 0,
};

export class HealthStore {
  private map = new Map<string, HealthRecord>();

  constructor(initial?: Record<string, HealthRecord>) {
    if (initial) {
      for (const [k, v] of Object.entries(initial)) this.map.set(k, { ...EMPTY, ...v });
    }
  }

  get(key: string): HealthRecord {
    return this.map.get(key) ?? EMPTY;
  }

  recordOk(key: string, ms: number): void {
    const r = this.get(key);
    // 指数移动平均，新样本权重 1/4，避免偶发抖动影响排序
    const avgMs = r.avgMs > 0 ? r.avgMs * 0.75 + ms * 0.25 : ms;
    this.map.set(key, {
      ...r,
      lastOk: Date.now(),
      okStreak: r.okStreak + 1,
      failStreak: 0,
      avgMs,
      okTotal: r.okTotal + 1,
    });
  }

  recordFail(key: string): void {
    const r = this.get(key);
    this.map.set(key, {
      ...r,
      lastFail: Date.now(),
      failStreak: r.failStreak + 1,
      okStreak: 0,
      failTotal: r.failTotal + 1,
    });
  }

  /**
   * 健康评分，越大越优先。
   * 从未探测过的源给一个中庸分（30），让它们有机会被试用。
   */
  score(key: string): number {
    const r = this.get(key);
    const total = r.okTotal + r.failTotal;
    if (total === 0) return 30;

    const successRate = r.okTotal / total; // 0..1
    let s = successRate * 100;
    // 连续失败快速降权，连续成功小幅加权
    s -= Math.min(r.failStreak, 5) * 12;
    s += Math.min(r.okStreak, 5) * 2;
    // 慢源降权：200ms 以内不罚，3000ms 扣 18 分
    if (r.avgMs > 200) s -= Math.min((r.avgMs - 200) / 2800, 1) * 18;
    return s;
  }

  /** 导出为可持久化的普通对象 */
  snapshot(): Record<string, HealthRecord> {
    return Object.fromEntries(this.map.entries());
  }

  /** 清空历史，让所有源回到同一起跑线 */
  reset(): void {
    this.map.clear();
  }
}

/** 按健康度降序排列源 */
export function sortByHealth<T extends { key: string }>(items: T[], health: HealthStore): T[] {
  return [...items].sort((a, b) => health.score(b.key) - health.score(a.key));
}
