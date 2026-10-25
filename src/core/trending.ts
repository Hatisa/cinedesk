/**
 * 实时热搜榜。
 *
 * 数据源用豆瓣的公开榜单接口（movie/tv 的「热门」与「综艺」），
 * 而不是自己拿采集源的最新入库列表凑数——后者的「最新」等于「刚被采集到」，
 * 混着大量老片与网络短剧，跟用户心里的「热播」不是一回事。
 *
 * 请求走 http.ts 的统一通道：APK 里是原生 OkHttp（不受同源策略限制），
 * 浏览器开发时走 vite 的 /__proxy 转发。
 *
 * 榜单是「锦上添花」而不是主功能，因此：
 *   - 先用本地缓存立即渲染，再后台刷新，避免进首页先看一段空白；
 *   - 接口挂了就回退到内置片名，搜索入口始终可用。
 */
import { httpGetJson } from './http';
import { loadJSON, saveJSON } from './store';

export type TrendingTab = 'movie' | 'tv' | 'show';

export interface TrendingEntry {
  title: string;
  /** 豆瓣评分，没有评分时为 0 */
  score: number;
  pic: string;
}

export const TRENDING_TABS: { key: TrendingTab; label: string }[] = [
  { key: 'movie', label: '电影' },
  { key: 'tv', label: '电视剧' },
  { key: 'show', label: '综艺' },
];

/**
 * 各榜单对应的豆瓣查询参数。
 * 综艺没有独立的 type，必须用 type=tv 配 tag=综艺。
 */
const QUERY: Record<TrendingTab, { type: string; tag: string }> = {
  movie: { type: 'movie', tag: '热门' },
  tv: { type: 'tv', tag: '热门' },
  show: { type: 'tv', tag: '综艺' },
};

const CACHE_KEY = 'cinedesk.trending.v1';
/** 榜单一天之内变化不大，缓存 6 小时足够，也省得每次开 App 都打接口 */
const CACHE_TTL = 6 * 60 * 60 * 1000;
const PAGE_LIMIT = 12;

export type TrendingMap = Record<TrendingTab, TrendingEntry[]>;

/**
 * 兜底片名。
 * 豆瓣接口不可达（断网、被限流、域名变更）时顶上，保证首页永远有东西可点。
 */
export const FALLBACK_TRENDING: TrendingMap = {
  movie: [
    { title: '流浪地球', score: 7.9, pic: '' },
    { title: '奥本海默', score: 8.9, pic: '' },
    { title: '沙丘', score: 7.7, pic: '' },
    { title: '让子弹飞', score: 9.0, pic: '' },
    { title: '盗梦空间', score: 9.4, pic: '' },
    { title: '活着', score: 9.3, pic: '' },
  ],
  tv: [
    { title: '庆余年', score: 7.9, pic: '' },
    { title: '狂飙', score: 8.5, pic: '' },
    { title: '琅琊榜', score: 9.4, pic: '' },
    { title: '甄嬛传', score: 9.4, pic: '' },
    { title: '三体', score: 8.7, pic: '' },
    { title: '漫长的季节', score: 9.4, pic: '' },
  ],
  show: [
    { title: '快乐再出发', score: 9.6, pic: '' },
    { title: '圆桌派', score: 9.1, pic: '' },
    { title: '向往的生活', score: 7.9, pic: '' },
    { title: '开讲啦', score: 8.5, pic: '' },
    { title: '歌手', score: 7.6, pic: '' },
    { title: '中国好声音', score: 7.4, pic: '' },
  ],
};

interface RawSubject {
  title?: string;
  rate?: string;
  cover?: string;
}

interface TrendingCache {
  at: number;
  data: Partial<Record<TrendingTab, TrendingEntry[]>>;
}

/** 只做形状校验：榜单里混进一条脏数据不该让整块渲染崩掉 */
function parseSubjects(raw: unknown): TrendingEntry[] {
  const list = (raw as { subjects?: RawSubject[] } | null)?.subjects;
  if (!Array.isArray(list)) return [];
  return list
    .map((s) => ({
      title: String(s?.title ?? '').trim(),
      score: Number.parseFloat(String(s?.rate ?? '')) || 0,
      pic: String(s?.cover ?? ''),
    }))
    .filter((e) => e.title.length > 0);
}

async function fetchTab(tab: TrendingTab, timeoutMs: number): Promise<TrendingEntry[]> {
  const { type, tag } = QUERY[tab];
  const url =
    'https://movie.douban.com/j/search_subjects' +
    `?type=${type}&tag=${encodeURIComponent(tag)}` +
    `&page_limit=${PAGE_LIMIT}&page_start=0`;
  const { json } = await httpGetJson(url, timeoutMs, { Referer: 'https://movie.douban.com/' });
  return parseSubjects(json);
}

/** 读取本地缓存（可能已过期，调用方自行判断 at） */
export async function loadTrendingCache(): Promise<TrendingCache | null> {
  const cache = await loadJSON<TrendingCache | null>(CACHE_KEY, null);
  if (!cache || typeof cache.at !== 'number') return null;
  return cache;
}

export function isFresh(cache: TrendingCache): boolean {
  return Date.now() - cache.at < CACHE_TTL;
}

/** 把缓存里的榜单补全为完整三档（缺的用兜底填上） */
export function expandCache(data: Partial<Record<TrendingTab, TrendingEntry[]>>): TrendingMap {
  return {
    movie: data.movie?.length ? data.movie : FALLBACK_TRENDING.movie,
    tv: data.tv?.length ? data.tv : FALLBACK_TRENDING.tv,
    show: data.show?.length ? data.show : FALLBACK_TRENDING.show,
  };
}

/**
 * 拉取全部榜单并写缓存。
 *
 * 三个榜单并发请求，任何一个失败都不影响其余两个——只把成功的部分写回缓存，
 * 失败的档位继续沿用上一次的数据（或兜底片名）。
 */
export async function refreshTrending(timeoutMs = 8000): Promise<TrendingMap> {
  const tabs = TRENDING_TABS.map((t) => t.key);
  const settled = await Promise.all(
    tabs.map(async (tab) => {
      try {
        return [tab, await fetchTab(tab, timeoutMs)] as const;
      } catch {
        return [tab, [] as TrendingEntry[]] as const;
      }
    }),
  );

  const prev = await loadTrendingCache();
  const data: Partial<Record<TrendingTab, TrendingEntry[]>> = {};
  let gotAny = false;
  for (const [tab, list] of settled) {
    if (list.length) {
      data[tab] = list;
      gotAny = true;
    } else if (prev?.data?.[tab]?.length) {
      // 这一档没拉到就沿用旧数据，不写空值把它冲掉
      data[tab] = prev.data[tab];
    }
  }

  if (gotAny) {
    void saveJSON(CACHE_KEY, { at: Date.now(), data } satisfies TrendingCache);
  }
  return expandCache(data);
}
