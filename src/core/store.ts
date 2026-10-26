/**
 * 本地持久化。
 *
 * 使用 @capacitor/preferences：在 Android 上落到原生 SharedPreferences，
 * 在浏览器里自动退回 localStorage。所有数据都留在设备本地，不上传任何服务器。
 */
import { Preferences } from '@capacitor/preferences';
// 仅类型导入：Quality 是缓存的清晰度档位，定义在下载引擎里
import type { Quality } from './download';
import type { FavoriteEntry, HealthRecord, HistoryEntry, SourceConfig } from './types';

export const KEYS = {
  sources: 'cinedesk.sources.v1',
  health: 'cinedesk.health.v1',
  history: 'cinedesk.history.v1',
  favorites: 'cinedesk.favorites.v1',
  settings: 'cinedesk.settings.v1',
  recent: 'cinedesk.recent.v1',
  offline: 'cinedesk.offline.v1',
} as const;

export interface Settings {
  /** 单个源的请求超时（毫秒） */
  timeoutMs: number;
  /** 观看历史是否记录 */
  recordHistory: boolean;
  /**
   * 离线缓存使用的清晰度档位。
   * 默认最高：缓存是「下载一次长期离线看」，画质优先于体积；
   * 存储紧张的用户可在设置里降到中/低。
   */
  cacheQuality: Quality;
}

export const DEFAULT_SETTINGS: Settings = {
  timeoutMs: 12000,
  recordHistory: true,
  cacheQuality: 'high',
};

export async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const { value } = await Preferences.get({ key });
    if (!value) return fallback;
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function saveJSON(key: string, value: unknown): Promise<void> {
  try {
    await Preferences.set({ key, value: JSON.stringify(value) });
  } catch {
    /* 存储失败不应影响使用 */
  }
}

export async function loadSources(fallback: SourceConfig[]): Promise<SourceConfig[]> {
  const list = await loadJSON<SourceConfig[]>(KEYS.sources, fallback);
  return Array.isArray(list) && list.length ? list : fallback;
}

export const loadHealth = (): Promise<Record<string, HealthRecord>> =>
  loadJSON<Record<string, HealthRecord>>(KEYS.health, {});

export const loadHistory = (): Promise<HistoryEntry[]> =>
  loadJSON<HistoryEntry[]>(KEYS.history, []);

export const loadFavorites = (): Promise<FavoriteEntry[]> =>
  loadJSON<FavoriteEntry[]>(KEYS.favorites, []);

/** 搜索历史（关键词），最多保留 8 条 */
export const loadRecent = (): Promise<string[]> => loadJSON<string[]>(KEYS.recent, []);

export function pushRecent(list: string[], kw: string): string[] {
  return [kw, ...list.filter((k) => k !== kw)].slice(0, 8);
}

export const loadSettings = (): Promise<Settings> =>
  loadJSON<Settings>(KEYS.settings, DEFAULT_SETTINGS);

/** 历史记录上限，超出丢弃最旧的 */
const HISTORY_MAX = 300;

export function pushHistory(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...list.filter((h) => h.key !== entry.key)];
  return next.slice(0, HISTORY_MAX);
}

export function toggleFavorite(list: FavoriteEntry[], entry: FavoriteEntry): FavoriteEntry[] {
  const exists = list.some((f) => f.key === entry.key);
  return exists ? list.filter((f) => f.key !== entry.key) : [entry, ...list];
}
