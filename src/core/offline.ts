/**
 * 离线库索引。
 *
 * 分片字节都躺在文件系统里，这里只存「清单」：哪部剧、缓存了哪几集、
 * 每集的分片文件名与时长、多大、什么画质。
 *
 * 清单为什么放 Preferences 而不是遍历目录：首页/我的页要能立刻列出
 * 已缓存内容（甚至没进播放页），Preferences 一次读取就拿到；
 * 遍历目录要等插件回调、还要逐个 stat，慢且容易卡首屏。
 *
 * 目录结构（一剧一目录，集号零填充，不同剧互不混杂）：
 *   cinedesk/庆余年 第一季/001_第01集/seg-000001.ts
 *                                /seg-000002.ts
 *   cinedesk/沉默的真相/001_第01集/…
 */
import type { Quality } from './download.ts';
import { type LocalSegment, pad, safeName } from './m3u8.ts';
import { KEYS, loadJSON, saveJSON } from './store.ts';

/** 一集的缓存清单 */
export interface OfflineEpisode {
  /** 集序号，从 0 开始，与 PlayLine.episodes 的下标一致 */
  epIndex: number;
  /** 集名，如「第01集」 */
  epName: string;
  /** 相对缓存根目录的该集目录，如「庆余年 第一季/001_第01集」 */
  dir: string;
  /** 分片清单（文件名 + 时长），播放时据此生成本地播放列表 */
  segments: LocalSegment[];
  bytes: number;
  /** 时长（秒） */
  duration: number;
  quality: Quality;
  /** 来自哪个源与线路，便于「换源重下」时说明来源 */
  sourceKey: string;
  sourceName: string;
  lineName: string;
  createdAt: number;
}

/** 一部剧的缓存清单 */
export interface OfflineShow {
  /** 聚合键（归一化片名），同一部剧只有一个条目 */
  key: string;
  name: string;
  pic: string;
  year: string;
  typeName: string;
  /** 该剧在缓存根目录下的目录名 */
  showDir: string;
  /** 已缓存的集，按集序升序 */
  episodes: OfflineEpisode[];
}

/** 键名短哈希：仅用于目录去重，不做任何安全用途 */
export function hash4(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  // 取 base36 的**低位**而非高位：相近字符串（key-a / key-b）的哈希差异
  // 集中在低位，截高位会把它们截成同一个值，目录去重随之失效。
  return (h >>> 0).toString(36).slice(-4).padStart(4, '0');
}

/**
 * 分配该剧的缓存目录名。
 *
 * 不能直接用清洗后的片名：不同作品可能清洗成同一个名字
 * （「庆余年:第一季」与「庆余年 第一季」都变成「庆余年_第一季」），
 * 撞车后两剧的分片会写进同一目录——正是要避免的「不同剧混杂」。
 * 这里在撞车且属不同作品时加短哈希后缀，目录名因此唯一且稳定。
 */
export function allocShowDir(list: OfflineShow[], name: string, key: string): string {
  const base = safeName(name);
  const owner = list.find((s) => s.showDir === base);
  if (!owner || owner.key === key) return base;
  return `${base}_${hash4(key)}`;
}

/** 一集的目录名：集号零填充，文件管理器按名排序即播出顺序 */
export function epDir(epIndex: number, epName: string): string {
  return `${pad(epIndex + 1, 3)}_${safeName(epName)}`;
}

export const loadOffline = async (): Promise<OfflineShow[]> => {
  const raw = await loadJSON<OfflineShow[]>(KEYS.offline, []);
  if (!Array.isArray(raw)) return [];
  // 过滤掉结构不完整的条目，避免脏数据让离线页整页崩掉
  return raw.filter((s) => s && typeof s.key === 'string' && Array.isArray(s.episodes));
};

export const saveOffline = (list: OfflineShow[]): Promise<void> => saveJSON(KEYS.offline, list);

export const findShow = (list: OfflineShow[], key: string): OfflineShow | undefined =>
  list.find((s) => s.key === key);

export const findEpisode = (
  list: OfflineShow[],
  key: string,
  epIndex: number,
): OfflineEpisode | undefined => findShow(list, key)?.episodes.find((e) => e.epIndex === epIndex);

/**
 * 写入/替换一集。
 * 同一集重复缓存（比如换了线路重下）按 epIndex 覆盖，不会出现两条。
 */
export function upsertEpisode(
  list: OfflineShow[],
  show: Omit<OfflineShow, 'episodes' | 'showDir'> & { showDir?: string },
  ep: OfflineEpisode,
): OfflineShow[] {
  const found = findShow(list, show.key);
  const showDir = found?.showDir ?? show.showDir ?? allocShowDir(list, show.name, show.key);
  const episodes = [...(found?.episodes ?? []).filter((e) => e.epIndex !== ep.epIndex), ep].sort(
    (a, b) => a.epIndex - b.epIndex,
  );
  const updated: OfflineShow = {
    key: show.key,
    name: show.name,
    pic: show.pic,
    year: show.year,
    typeName: show.typeName,
    showDir,
    episodes,
  };
  return [updated, ...list.filter((s) => s.key !== show.key)];
}

/** 删除一集；该剧最后一集被删掉时，整部剧的条目一并移除 */
export function removeEpisode(list: OfflineShow[], key: string, epIndex: number): OfflineShow[] {
  const show = findShow(list, key);
  if (!show) return list;
  const episodes = show.episodes.filter((e) => e.epIndex !== epIndex);
  // 空剧条目留着只会让离线页出现无内容的卡片，直接去掉
  if (!episodes.length) return list.filter((s) => s.key !== key);
  return list.map((s) => (s.key === key ? { ...s, episodes } : s));
}

export function removeShow(list: OfflineShow[], key: string): OfflineShow[] {
  return list.filter((s) => s.key !== key);
}

/** 已缓存总字节数 */
export const totalBytes = (list: OfflineShow[]): number =>
  list.reduce((sum, s) => sum + s.episodes.reduce((a, e) => a + (e.bytes || 0), 0), 0);

/** 已缓存总集数 */
export const totalEpisodes = (list: OfflineShow[]): number =>
  list.reduce((n, s) => n + s.episodes.length, 0);
