/**
 * 「猜你喜欢」推荐。
 *
 * 数据源用采集源自己的分类接口，而不是豆瓣的相似推荐：
 * 豆瓣的推荐接口需要登录、且字段频繁变动，而采集源的 `ac=list` 能列出全部
 * 分类，`ac=detail&t=<分类id>` 会直接返回该分类下的完整条目——**连
 * vod_play_url 一起返回**。也就是说推荐位里的影片点开即可播放，不需要
 * 再拿片名去搜一遍，这是它比「按片名回搜」更可靠的地方。
 *
 * 相似度完全在本地算，不依赖任何外部推荐服务，顺序为：
 *   同演员 > 同导演 > 同类型 > 评分接近 > 年代接近。
 *
 * 推荐是锦上添花，因此全程「静默失败」：拿不到候选就整块不显示，
 * 不弹错误、不阻塞详情页。
 */
import { extractList, toVodItem } from './cms';
import { classifyContent, normalizeName } from './filter';
import { buildApiUrl, httpGetJson } from './http';
import type { AggregatedItem, RawVodResponse, SourceConfig, VodItem } from './types';

/** 最多同时查两个分类，避免为一个推荐位打四五个请求 */
const MAX_TYPES = 2;
/*
 * 采样页码。分类接口按时间倒序返回，只取第 1 页等于「同分类最新的 20 条」，
 * 推荐会整体偏向新片——实测给 2019 年的《庆余年》推荐出 2026 年的剧。
 * 跨越目录前中后段采样，候选池里才会出现同年代、同演员的老片。
 */
const SAMPLE_PAGES = [1, 10, 40];
export const MAX_RECOMMEND = 10;
/** 同一部影片的推荐结果缓存半小时，来回切页面不重复请求 */
const CACHE_TTL = 30 * 60 * 1000;

interface Category {
  type_id: string;
  type_name: string;
}

interface CategoryCache {
  at: number;
  list: Category[];
}

const categoryCache = new Map<string, CategoryCache>();
const resultCache = new Map<string, { at: number; items: AggregatedItem[] }>();

/** 取某个源的分类表（带缓存） */
async function loadCategories(source: SourceConfig, timeoutMs: number): Promise<Category[]> {
  const hit = categoryCache.get(source.key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.list;

  const { json } = await httpGetJson<RawVodResponse & { class?: Category[] }>(
    buildApiUrl(source.api, { ac: 'list' }),
    timeoutMs,
  );
  const raw = (json as { class?: unknown } | null)?.class;
  if (!Array.isArray(raw)) return [];

  // 只认形状合法的条目：有的源返回的 class 里混着 null
  const list = raw
    .map((c) => c as Partial<Category>)
    .filter((c) => c && c.type_id !== undefined && typeof c.type_name === 'string')
    .map((c) => ({ type_id: String(c.type_id), type_name: String(c.type_name) }));

  if (list.length) categoryCache.set(source.key, { at: Date.now(), list });
  return list;
}

/** 把影片的分类文本映射到该源的分类 id */
function pickTypes(typeName: string, cats: Category[]): Category[] {
  const keys = typeName
    .split(/[/,，]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  if (!keys.length) return [];

  const seen = new Set<string>();
  const out: Category[] = [];
  for (const c of cats) {
    // 「剧情」要能命中「剧情片」，「内地剧」要能命中「内地剧」——
    // 双向包含判断比精确相等宽容得多，这正是各源分类名不统一的现实
    const matched = keys.some((k) => c.type_name.includes(k) || k.includes(c.type_name));
    if (matched && !seen.has(c.type_id)) {
      seen.add(c.type_id);
      out.push(c);
    }
  }
  return out.slice(0, MAX_TYPES);
}

/** 演员/导演串拆成名字集合，过滤掉空值与明显的占位文本 */
function nameSet(text: string): Set<string> {
  return new Set(
    text
      .split(/[/,，、]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 12),
  );
}

function intersect(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of b) if (a.has(x)) n++;
  return n;
}

/** 推荐时要用到的「目标影片特征」 */
interface Target {
  name: string;
  year: string;
  typeName: string;
  score: number;
  actor: string;
  director: string;
}

/** 从聚合条目里抽特征。演员/导演只在 variant 上，取线路最多的那条作准 */
export function toTarget(item: AggregatedItem): Target {
  const primary = [...item.variants].sort(
    (a, b) => (b.lines[0]?.episodes.length ?? 0) - (a.lines[0]?.episodes.length ?? 0),
  )[0];
  return {
    name: item.name,
    year: item.year,
    typeName: item.typeName,
    score: item.score,
    actor: primary?.actor ?? '',
    director: primary?.director ?? '',
  };
}

/**
 * 相似度打分。数值本身没有绝对意义，只用于同级排序，
 * 各权重按「用户会因此认为是同一类作品」的强度来定。
 */
function similarity(target: Target, cand: VodItem): number {
  let s = 0;

  // 同演员：最强的信号。见过同一批演员的作品，多半想看
  s += Math.min(intersect(nameSet(target.actor), nameSet(cand.actor)), 3) * 30;
  // 同导演：风格更一致，给最高的单项权重
  if (target.director && cand.director && intersect(nameSet(target.director), nameSet(cand.director)) > 0) {
    s += 45;
  }
  // 同类型
  s += Math.min(intersect(nameSet(target.typeName), nameSet(cand.typeName)), 3) * 12;
  // 评分接近：同为高分作品更可能合口味
  if (target.score > 0 && cand.score > 0) {
    s += Math.max(0, 20 - Math.abs(target.score - cand.score) * 8);
  }
  // 年代接近
  const ty = Number.parseInt(target.year, 10);
  const cy = Number.parseInt(cand.year, 10);
  if (ty && cy) s += Math.max(0, 10 - Math.abs(ty - cy) * 2);

  return s;
}

export interface RecommendOptions {
  /** 用哪个源查候选。分类 id 是源私有的，必须用影片自身所在的源 */
  source: SourceConfig;
  timeoutMs?: number;
  signal?: { aborted: boolean };
}

/**
 * 取「猜你喜欢」。
 * 返回空数组表示这次没拿到候选——调用方直接不渲染该区块即可。
 */
export async function recommendFor(
  target: AggregatedItem,
  opts: RecommendOptions,
): Promise<AggregatedItem[]> {
  const { source, timeoutMs = 10000 } = opts;
  const cacheKey = `${source.key}|${normalizeName(target.name)}`;
  const hit = resultCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.items;

  const cats = await loadCategories(source, timeoutMs);
  if (opts.signal?.aborted) return [];

  /*
   * 各来源给同一部影片标的主分类并不一致：同一部片在一个源是「剧情」，
   * 在另一个源是「国产剧」或「古装」。只看聚合后的那一个分类，
   * 候选范围会窄到只剩一类，推荐自然就偏了；
   * 合并所有来源的分类文本，才能覆盖到更多合适的候选分类。
   */
  const typeText = [...new Set(target.variants.map((v) => v.typeName).filter(Boolean))].join(',');
  const types = pickTypes(typeText, cats);
  if (!types.length) return [];

  /*
   * 按「分类 × 采样页码」并发取候选。
   * 页码跨越目录前/中/后段，避免候选池被最新影片占满。
   * toVodItem 会在这一步挡掉成人条目与无直链线路的条目。
   */
  const jobs: Promise<VodItem[]>[] = [];
  for (const t of types) {
    for (const pg of SAMPLE_PAGES) {
      jobs.push(
        httpGetJson<RawVodResponse>(
          buildApiUrl(source.api, { ac: 'detail', t: t.type_id, pg: String(pg) }),
          timeoutMs,
        ).then(({ json }) =>
          extractList(json)
            .map((raw) => toVodItem(raw, source))
            .filter((x): x is VodItem => x !== null),
        ),
      );
    }
  }
  const pages = await Promise.all(jobs);
  if (opts.signal?.aborted) return [];

  const targetKey = normalizeName(target.name);
  const seen = new Set<string>([targetKey]);
  const scored: { item: VodItem; s: number }[] = [];
  // 特征只抽一次，循环里反复用
  const tgt = toTarget(target);

  for (const item of pages.flat()) {
    // 候选已在取回时经 toVodItem 过滤，成人条目与无直链线路的都已被挡掉
    const key = normalizeName(item.name);
    if (!key || seen.has(key)) continue;

    /*
     * 推荐位要的是「值得一看的作品」，不是「同分类的一切」。
     * 短剧是流水线批量生产的，同分类下数量极多，混进来会把真正的影视作品
     * 冲掉，因此这里直接排除——首页排序对短剧是降权，推荐位则是剔除。
     */
    const verdict = classifyContent({ name: item.name, classText: item.typeName, score: item.score });
    if (verdict.shortDrama) continue;

    seen.add(key);
    scored.push({ item, s: similarity(tgt, item) });
  }

  /*
   * 排序：相似度优先，其次有海报的靠前（推荐位全靠海报吸引点击），
   * 再其次有豆瓣评分的靠前（说明是正经作品），最后按评分降序。
   */
  scored.sort(
    (a, b) =>
      b.s - a.s ||
      Number(Boolean(b.item.pic)) - Number(Boolean(a.item.pic)) ||
      Number(b.item.score > 0) - Number(a.item.score > 0) ||
      b.item.score - a.item.score,
  );

  const items = scored.slice(0, MAX_RECOMMEND).map((s) => toAggregated(s.item));
  resultCache.set(cacheKey, { at: Date.now(), items });
  return items;
}

/**
 * 单条候选包成聚合结构。
 * 候选自带完整播放地址，所以这里只需一个 variant，点进详情页就能直接播。
 */
function toAggregated(v: VodItem): AggregatedItem {
  return {
    key: normalizeName(v.name),
    name: v.name,
    pic: v.pic,
    remarks: v.remarks,
    year: v.year,
    typeName: v.typeName,
    score: v.score,
    shortDrama: v.shortDrama,
    variants: [v],
  };
}

/** 清空缓存（设置页重置源列表后调用） */
export function clearRecommendCache(): void {
  categoryCache.clear();
  resultCache.clear();
}
