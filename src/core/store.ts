/**
 * 本地持久化。
 *
 * 使用 @capacitor/preferences：在 Android 上落到原生 SharedPreferences，
 * 在浏览器里自动退回 localStorage。所有数据都留在设备本地，不上传任何服务器。
 */
import { Preferences } from '@capacitor/preferences';
import type { FavoriteEntry, HealthRecord, HistoryEntry, SourceConfig } from './types';
import { upgradeSavedWorkKey } from './work.ts';

export const KEYS = {
  sources: 'cinedesk.sources.v1',
  health: 'cinedesk.health.v1',
  history: 'cinedesk.history.v1',
  favorites: 'cinedesk.favorites.v1',
  settings: 'cinedesk.settings.v1',
  recent: 'cinedesk.recent.v1',
  search: 'cinedesk.search.v1',
} as const;

export interface Settings {
  /** 单个源的请求超时（毫秒） */
  timeoutMs: number;
  /** 观看历史是否记录 */
  recordHistory: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  timeoutMs: 12000,
  recordHistory: true,
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

export const loadFavorites = async (): Promise<FavoriteEntry[]> => {
  const list = await loadJSON<FavoriteEntry[]>(KEYS.favorites, []);
  if (!Array.isArray(list)) return [];
  const next = list.filter((entry) => entry && typeof entry.name === 'string').map(upgradeSavedWorkKey);
  if (next.some((entry, i) => entry !== list[i])) void saveJSON(KEYS.favorites, next);
  return next;
};

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
  const next = [entry, ...list.filter((h) => h.key !== entry.key || h.sourceKey !== entry.sourceKey || h.vodId !== entry.vodId)];
  return next.slice(0, HISTORY_MAX);
}

export function toggleFavorite(list: FavoriteEntry[], entry: FavoriteEntry): FavoriteEntry[] {
  const exists = list.some((f) => f.key === entry.key && f.sourceKey === entry.sourceKey && f.vodId === entry.vodId);
  return exists ? list.filter((f) => f.key !== entry.key || f.sourceKey !== entry.sourceKey || f.vodId !== entry.vodId) : [entry, ...list];
}
