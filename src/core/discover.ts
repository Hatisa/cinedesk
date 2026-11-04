/**
 * 首页内容发现：只访问公开采集接口，不发送收藏或历史。
 * 推荐仅根据最近一部观看/收藏的作品在本地计算相似度；失败时返回空数组。
 */
import { extractList, toVodItem } from './cms.ts';
import { fetchById, mergeItems } from './aggregate.ts';
import { isDerivative } from './searchPresentation.ts';
import { buildApiUrl, httpGetJson } from './http.ts';
import { HealthStore, sortByHealth } from './health.ts';
import { recommendFor } from './recommend.ts';
import type { AggregatedItem, RawVodResponse, SourceConfig } from './types';
import type { SavedWork } from './work';

export interface DiscoverOptions {
  sources: SourceConfig[];
  health: HealthStore;
  timeoutMs?: number;
  signal?: AbortSignal;
}

let latestCache: { at: number; items: AggregatedItem[] } | null = null;
const CACHE_TTL = 30 * 60 * 1000;

/** 用最近一部本地记录生成推荐，不向推荐接口发送观看清单。 */
export async function recommendFromSaved(saved: SavedWork | undefined, opts: DiscoverOptions): Promise<AggregatedItem[]> {
  if (!saved) return [];
  const source = opts.sources.find((s) => s.key === saved.sourceKey && s.enabled);
  if (!source) return [];
  const target = await fetchById(source, saved.vodId, opts);
  if (!target || opts.signal?.aborted) return [];
  return recommendFor(target, { source, timeoutMs: opts.timeoutMs, signal: opts.signal });
}

/** 从健康度最好的两个源取最近更新；合并同作并过滤短剧、解说与预告。 */
export async function loadLatestUpdates(opts: DiscoverOptions): Promise<AggregatedItem[]> {
  if (latestCache && Date.now() - latestCache.at < CACHE_TTL) return latestCache.items;
  const active = sortByHealth(opts.sources.filter((s) => s.enabled), opts.health).slice(0, 2);
  const outcomes = await Promise.all(active.map(async (source) => {
    try {
      const { json } = await httpGetJson<RawVodResponse>(
        buildApiUrl(source.api, { ac: 'videolist', pg: '1' }), opts.timeoutMs ?? 12000, {}, opts.signal,
      );
      const items = extractList(json).map((raw) => toVodItem(raw, source)).filter((v) => v !== null);
      return { source, items, status: { key: source.key, name: source.name, state: 'ok' as const, count: items.length, ms: 0 } };
    } catch {
      return { source, items: [], status: { key: source.key, name: source.name, state: 'fail' as const, count: 0, ms: 0 } };
    }
  }));
  if (opts.signal?.aborted) return [];
  const items = mergeItems(outcomes, opts.health)
    .filter((item) => !item.shortDrama && !isDerivative(item))
    .slice(0, 12);
  latestCache = { at: Date.now(), items };
  return items;
}

export function clearDiscoveryCache(): void {
  latestCache = null;
}
