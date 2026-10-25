/**
 * 多源并发聚合。
 *
 * 这是「稳定」的全部来源。实测同一批源里约 1/3 在任意时刻不可用，
 * 且哪些可用会随时间变化，所以做法不是挑一个「最好的源」，而是：
 *
 *   1. 并发向所有启用的源发起搜索，互不阻塞——慢源不会拖住快源；
 *   2. 按 health.ts 的健康评分排序，好源优先、坏源沉底；
 *   3. 同名影片跨源合并为一条，内部保留所有可用线路，播放失败可一键换源；
 *   4. 每次结果都回收为健康度，让排序随真实表现自我修正。
 */
import { extractList, toVodItem } from './cms';
import { normalizeName } from './filter';
import { buildApiUrl, httpGetJson } from './http';
import { HealthStore, sortByHealth } from './health';
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
  /** 每拿到一个源的结果就回调一次，用于界面渐进式展示 */
  onStatus?: (status: SourceStatus) => void;
  /** 每完成一个源就回调，用于边搜边出结果 */
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
  const { json, result } = await httpGetJson<RawVodResponse>(url, opts.timeoutMs ?? 12000);
  const ms = Date.now() - t0;

  // 接口不通：记失败，让健康分下降
  if (!json) {
    opts.health.recordFail(source.key);
    const status: SourceStatus = {
      key: source.key,
      name: source.name,
      state: 'fail',
      count: 0,
      ms,
      error: result.error || `HTTP ${result.status || '???'}`,
    };
    opts.onStatus?.(status);
    return { source, items: [], status };
  }

  const rawList = extractList(json);
  const items = rawList
    .map((r) => toVodItem(r, source))
    .filter((v): v is VodItem => v !== null);

  // 接口返回 200 且结构合法 → 源是健康的，即使没搜到片子
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

/** 跨源合并同名影片 */
function mergeItems(outcomes: SourceOutcome[], health: HealthStore): AggregatedItem[] {
  const map = new Map<string, AggregatedItem>();

  for (const { items } of outcomes) {
    for (const item of items) {
      const key = normalizeName(item.name);
      if (!key) continue;
      let agg = map.get(key);
      if (!agg) {
        agg = {
          key,
          name: item.name,
          pic: item.pic,
          remarks: item.remarks,
          year: item.year,
          typeName: item.typeName,
          score: item.score,
          variants: [],
        };
        map.set(key, agg);
      }
      // 只保留同一源的第一个副本，避免重复线路
      if (!agg.variants.some((v) => v.sourceKey === item.sourceKey)) {
        agg.variants.push(item);
      }
      if (!agg.pic && item.pic) agg.pic = item.pic;
      if (!agg.remarks && item.remarks) agg.remarks = item.remarks;
      if (!agg.year && item.year) agg.year = item.year;
      if (!agg.typeName && item.typeName) agg.typeName = item.typeName;
      if (item.score > agg.score) agg.score = item.score;
    }
  }

  const list = [...map.values()];

  // 线路内部按健康度排序 —— 用户默认拿到的是最快最稳的那条
  for (const agg of list) {
    agg.variants.sort((a, b) => health.score(b.sourceKey) - health.score(a.sourceKey));
  }

  // 结果排序：被越多源收录说明越热门可靠；同分再看评分
  list.sort((a, b) => b.variants.length - a.variants.length || b.score - a.score);
  return list;
}

/** 对所有启用源并发搜索并聚合 */
export async function searchAll(keyword: string, opts: SearchOptions): Promise<SearchResult> {
  const started = Date.now();
  const kw = keyword.trim();
  const active = sortByHealth(
    opts.sources.filter((s) => s.enabled),
    opts.health,
  );

  if (!kw || !active.length) {
    return { keyword: kw, items: [], statuses: [], totalMs: 0 };
  }

  const statuses: SourceStatus[] = [];
  const outcomes: SourceOutcome[] = [];
  const track = (status: SourceStatus) => {
    const i = statuses.findIndex((s) => s.key === status.key);
    if (i >= 0) statuses[i] = status;
    else statuses.push(status);
    opts.onStatus?.(status);
  };

  // 并发发起，全部结束后统一 reactive 更新一次
  const results = await Promise.all(
    active.map((s) => queryOne(s, kw, { ...opts, onStatus: track })),
  );
  outcomes.push(...results);

  const items = mergeItems(outcomes, opts.health);
  return {
    keyword: kw,
    items,
    statuses: [...statuses].filter((s) => s.state !== 'loading'),
    totalMs: Date.now() - started,
  };
}

/**
 * 快速探测一批源是否可用（设置页「测速」用）。
 * 用较短的超时，避免用户久等。
 */
export async function probeSources(
  sources: SourceConfig[],
  opts: { health: HealthStore; timeoutMs?: number; onStatus?: (s: SourceStatus) => void },
): Promise<SourceStatus[]> {
  const keyword = '测试';
  const out = await Promise.all(
    sources.map((s) =>
      queryOne(s, keyword, {
        sources,
        health: opts.health,
        timeoutMs: opts.timeoutMs ?? 8000,
        onStatus: opts.onStatus,
      }),
    ),
  );
  return out.map((o) => o.status);
}
