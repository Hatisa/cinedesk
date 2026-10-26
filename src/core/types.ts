/**
 * 核心领域模型。
 *
 * 采集接口遵循「苹果 CMS / MacCMS 10」的 vod 协议，字段名沿用 vod_* 原样，
 * 便于与各资源站接口文档一一对照。
 */

/** 一个采集源配置 */
export interface SourceConfig {
  /** 稳定唯一标识，用于健康度记录与去重 */
  key: string;
  /** 展示名 */
  name: string;
  /** 采集接口地址，形如 https://host/api.php/provide/vod */
  api: string;
  /** 站点主页（可选，仅作展示） */
  detail?: string;
  /** 是否参与搜索 */
  enabled: boolean;
  /** 是否为内置源（内置源不可删除，只能停用） */
  builtin: boolean;
}

/** 采集接口返回的原始条目 */
export interface RawVod {
  vod_id: number | string;
  vod_name?: string;
  vod_pic?: string;
  vod_remarks?: string;
  vod_year?: string;
  vod_area?: string;
  vod_class?: string;
  vod_douban_score?: string | number;
  vod_score?: string | number;
  vod_play_from?: string;
  vod_play_url?: string;
  vod_actor?: string;
  vod_director?: string;
  vod_content?: string;
  vod_time?: string;
  type_name?: string;
}

/** 采集接口的通用响应外壳 */
export interface RawVodResponse {
  code?: number;
  msg?: string;
  page?: number;
  pagecount?: number;
  limit?: string | number;
  total?: string | number;
  list?: RawVod[];
  class?: unknown[];
}

/** 单集 */
export interface Episode {
  /** 集序号，从 0 开始 */
  index: number;
  /** 集名，如「第01集」 */
  name: string;
  /** 播放地址 */
  url: string;
}

/** 一条播放线路（对应 vod_play_from 中的一个） */
export interface PlayLine {
  /** 线路名，如 jsm3u8 / jinyingm3u8 */
  name: string;
  episodes: Episode[];
  /**
   * 是否为可直接播放的地址（.m3u8 / .mp4）。
   * 为 false 时通常是一个播放页，需要二次解析才能拿到真实地址。
   */
  direct: boolean;
}

/** 归一化后的影片条目（来自某一个源） */
export interface VodItem {
  sourceKey: string;
  sourceName: string;
  vodId: string;
  name: string;
  pic: string;
  /** 备注，通常表示更新进度，如「更新至36集」 */
  remarks: string;
  year: string;
  area: string;
  typeName: string;
  /** 豆瓣评分，0 表示无 */
  score: number;
  actor: string;
  director: string;
  content: string;
  lines: PlayLine[];
  /** 是否被判定为网络短剧（分类命中短剧/AI漫剧/反转爽剧等） */
  shortDrama: boolean;
}

/** 跨源聚合后的搜索结果：同名影片合并为一条，内部保留各源副本 */
export interface AggregatedItem {
  /** 归一化名称，作为聚合键 */
  key: string;
  name: string;
  pic: string;
  remarks: string;
  year: string;
  typeName: string;
  score: number;
  /**
   * 是否短剧。只要**任一**来源把它归入短剧分类即为真——
   * 实测同一部「庆余年之风起沧州」在 ffzy 标为「短剧」、在 jszy 标为「古装仙侠」，
   * 取「或」才能避免短剧借正常源的分类蒙混到前面。
   */
  shortDrama: boolean;
  /** 各来源副本，按健康度排序 */
  variants: VodItem[];
}

/** 单个源在一次搜索中的状态 */
export interface SourceStatus {
  key: string;
  name: string;
  state: 'loading' | 'ok' | 'empty' | 'fail';
  count: number;
  ms: number;
  error?: string;
}

/** 一次聚合搜索的完整结果 */
export interface SearchResult {
  keyword: string;
  items: AggregatedItem[];
  statuses: SourceStatus[];
  totalMs: number;
}

/** 源健康度记录 */
export interface HealthRecord {
  /** 最近一次成功时间戳 */
  lastOk: number;
  /** 最近一次失败时间戳 */
  lastFail: number;
  /** 连续成功次数，用于建立信任 */
  okStreak: number;
  /** 连续失败次数，连续失败会被降权或自动停用 */
  failStreak: number;
  /** 指数移动平均耗时（毫秒） */
  avgMs: number;
  /** 累计成功/失败，用于统计成功率 */
  okTotal: number;
  failTotal: number;
}

/** 观看历史 */
export interface HistoryEntry {
  /** 聚合键 */
  key: string;
  name: string;
  pic: string;
  sourceKey: string;
  sourceName: string;
  vodId: string;
  episodeIndex: number;
  episodeName: string;
  /** 播放进度（秒） */
  position: number;
  /** 总时长（秒），0 表示未知 */
  duration: number;
  updatedAt: number;
}

/** 收藏 */
export interface FavoriteEntry {
  key: string;
  name: string;
  pic: string;
  year: string;
  remarks: string;
  sourceKey: string;
  sourceName: string;
  vodId: string;
  addedAt: number;
}
