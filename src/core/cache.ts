/**
 * 进程内缓存。
 *
 * 采集接口的列表响应已经把 vod_play_url（全部集数的播放地址）一起返回了，
 * 所以点进详情页不需要再发请求——把搜索结果留在内存里直接复用即可。
 * 这样从搜索到起播只需一次网络往返。
 */
import type { AggregatedItem } from './types';

const TTL = 30 * 60 * 1000; // 30 分钟
const MAX = 300;

interface Entry {
  item: AggregatedItem;
  at: number;
}

const cache = new Map<string, Entry>();

export function putItems(items: AggregatedItem[]): void {
  const now = Date.now();
  for (const item of items) cache.set(item.key, { item, at: now });
  // 简单淘汰：超量时按时间清掉最旧的一批
  if (cache.size > MAX) {
    const sorted = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of sorted.slice(0, cache.size - MAX)) cache.delete(k);
  }
}

export function getItem(key: string): AggregatedItem | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL) {
    cache.delete(key);
    return null;
  }
  return hit.item;
}

export function clearCache(): void {
  cache.clear();
}
