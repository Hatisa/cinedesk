import { extractList, toVodItem } from './cms.ts';
import { contentRank } from './filter.ts';
import { buildApiUrl, httpGetJson } from './http.ts';
import { HealthStore, sortByHealth } from './health.ts';
import { canAddVariant, compatibleWork, titleRelevance, workKeyFor, workVariantKey } from './work.ts';
import type {
  AggregatedItem,
  RawVodResponse,
  SearchResult,
  SourceConfig,
  SourceStatus,
  VodItem,
} from './types';

export interface SearchOptions {
  sources: SourceConfig[];
  health: HealthStore;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStatus?: (status: SourceStatus) => void;
  /** 每完成一个源，就提供按当前结果重新聚合、排序的不可变快照。 */
  onPartial?: (items: AggregatedItem[], statuses: SourceStatus[]) => void;
}

interface SourceOutcome {
  source: SourceConfig;
  items: VodItem[];
  status: SourceStatus;
}

async function queryOne(source: SourceConfig, keyword: string, opts: SearchOptions): Promise<SourceOutcome> {
  const t0 = Date.now();
  opts.onStatus?.({ key: source.key, name: source.name, state: 'loading', count: 0, ms: 0 });
  const url = buildApiUrl(source.api, { ac: 'videolist', wd: keyword });
  const { json, result } = await httpGetJson<RawVodResponse>(
    url,
    opts.timeoutMs ?? 12000,
    {},
    opts.signal,
  );
  const ms = Date.now() - t0;
  if (result.error === 'cancelled' || opts.signal?.aborted) {
    return { source, items: [], status: { key: source.key, name: source.name, state: 'fail', count: 0, ms, error: 'cancelled' } };
  }
  if (!json) {
    opts.health.recordFail(source.key);
    const status: SourceStatus = { key: source.key, name: source.name, state: 'fail', count: 0, ms, error: result.error || `HTTP ${result.status || '???'}` };
    opts.onStatus?.(status);
    return { source, items: [], status };
  }
  const items = extractList(json)
    .map((r) => toVodItem(r, source))
    .filter((v): v is VodItem => v !== null);
  opts.health.recordOk(source.key, ms);
  const status: SourceStatus = {
    key: source.key,
    name: source.name,
    state: items.length ? 'ok' : 'empty',
    count: items.length,
    ms,
  };
  opts.onStatus?.(status);
  return { source, items, status };
}

/** 同名同年的跨源副本可以合并；年份冲突、同源不同ID必须保留独立版本。 */
export function mergeItems(outcomes: SourceOutcome[], health: HealthStore): AggregatedItem[] {
  const groups: AggregatedItem[] = [];
  for (const { items } of outcomes) {
    for (const item of items) {
      let agg = groups.find((g) => compatibleWork(g, item) && canAddVariant(g, item));
      if (!agg) {
        agg = {
          key: workKeyFor(item),
          name: item.name,
          pic: item.pic,
          remarks: item.remarks,
          year: item.year,
          typeName: item.typeName,
          score: item.score,
          scoreSource: item.scoreSource,
          shortDrama: item.shortDrama,
          variants: [],
        };
        // 同名同年的不同来源ID也不能共用一个React key或详情路由。
        if (groups.some((g) => g.key === agg!.key)) agg.key = workVariantKey(item);
        groups.push(agg);
      }
      // 同一条目经渐进搜索重复合并时只更新，不重复加线路。
      if (!agg.variants.some((v) => v.sourceKey === item.sourceKey && v.vodId === item.vodId)) {
        agg.variants.push(item);
      }
      if (!agg.pic && item.pic) agg.pic = item.pic;
      if (!agg.remarks && item.remarks) agg.remarks = item.remarks;
      if (!agg.year && item.year) agg.year = item.year;
      if (!agg.typeName && item.typeName) agg.typeName = item.typeName;
      if (item.score > 0 && (
        (item.scoreSource === 'douban' && (agg.scoreSource !== 'douban' || item.score > agg.score)) ||
        (item.scoreSource === 'site' && agg.scoreSource !== 'douban' && item.score > agg.score)
      )) {
        agg.score = item.score;
        agg.scoreSource = item.scoreSource;
      }
      if (item.shortDrama) agg.shortDrama = true;
    }
  }
  // 首条缺年份、后续补上真实年份时，更新路由身份。
  for (const agg of groups) {
    const year = agg.variants.map((v) => v.year).find(Boolean);
    if (year) agg.year = year;
    if (agg.key === workKeyFor({ name: agg.name, year: '' })) agg.key = workKeyFor(agg);
    agg.variants.sort((a, b) => health.score(b.sourceKey) - health.score(a.sourceKey));
  }
  return groups;
}

export function sortSearchItems(items: AggregatedItem[], keyword: string): AggregatedItem[] {
  return [...items].sort(
    (a, b) =>
      Number(titleRelevance(a.name, keyword) !== 0) - Number(titleRelevance(b.name, keyword) !== 0) ||
      contentRank(a) - contentRank(b) ||
      titleRelevance(a.name, keyword) - titleRelevance(b.name, keyword) ||
      (b.scoreSource === 'douban' ? b.score : 0) - (a.scoreSource === 'douban' ? a.score : 0) ||
      b.variants.length - a.variants.length,
  );
}

/** 单个源的详情恢复也复用同一聚合规则，保持路由键一致。 */
function aggregateVod(vod: VodItem, health: HealthStore): AggregatedItem {
  return mergeItems([{ source: { key: vod.sourceKey, name: vod.sourceName } as SourceConfig, items: [vod], status: { key: vod.sourceKey, name: vod.sourceName, state: 'ok', count: 1, ms: 0 } }], health)[0];
}

export async function searchAll(keyword: string, opts: SearchOptions): Promise<SearchResult> {
  const started = Date.now();
  const kw = keyword.trim();
  const active = sortByHealth(opts.sources.filter((s) => s.enabled), opts.health);
  if (!kw || !active.length) return { keyword: kw, items: [], statuses: [], totalMs: 0 };

  const statuses: SourceStatus[] = [];
  const outcomes: SourceOutcome[] = [];
  const track = (status: SourceStatus) => {
    if (opts.signal?.aborted) return;
    const i = statuses.findIndex((s) => s.key === status.key);
    if (i >= 0) statuses[i] = status;
    else statuses.push(status);
    opts.onStatus?.({ ...status });
  };
  await Promise.all(
    active.map(async (source) => {
      const outcome = await queryOne(source, kw, { ...opts, onStatus: track });
      if (opts.signal?.aborted || outcome.status.error === 'cancelled') return;
      outcomes.push(outcome);
      opts.onPartial?.(sortSearchItems(mergeItems(outcomes, opts.health), kw), statuses.map((s) => ({ ...s })));
    }),
  );
  return {
    keyword: kw,
    items: sortSearchItems(mergeItems(outcomes, opts.health), kw),
    statuses: statuses.filter((s) => s.state !== 'loading').map((s) => ({ ...s })),
    totalMs: Date.now() - started,
  };
}

export async function fetchById(
  source: SourceConfig,
  vodId: string,
  opts: { health: HealthStore; timeoutMs?: number; signal?: AbortSignal },
): Promise<AggregatedItem | null> {
  if (!vodId) return null;
  const t0 = Date.now();
  const url = buildApiUrl(source.api, { ac: 'videolist', ids: vodId });
  const { json, result } = await httpGetJson<RawVodResponse>(url, opts.timeoutMs ?? 12000, {}, opts.signal);
  if (!json) {
    if (!opts.signal?.aborted && result.error !== 'cancelled') opts.health.recordFail(source.key);
    return null;
  }
  const raw = extractList(json)[0];
  opts.health.recordOk(source.key, Date.now() - t0);
  const vod = raw ? toVodItem(raw, source) : null;
  return vod ? aggregateVod(vod, opts.health) : null;
}

export async function probeSources(
  sources: SourceConfig[],
  opts: { health: HealthStore; timeoutMs?: number; onStatus?: (s: SourceStatus) => void; signal?: AbortSignal },
): Promise<SourceStatus[]> {
  const out = await Promise.all(
    sources.map((s) => queryOne(s, '测试', {
      sources, health: opts.health, timeoutMs: opts.timeoutMs ?? 8000,
      onStatus: opts.onStatus, signal: opts.signal,
    })),
  );
  return out.map((o) => o.status);
}
