import type { AggregatedItem, SourceStatus } from './types';

export interface SearchSnapshot {
  keyword: string;
  items: AggregatedItem[];
  statuses: SourceStatus[];
  totalMs: number;
  savedAt?: number;
  scrollY?: number;
}

export const SEARCH_TTL = 24 * 60 * 60 * 1000;
export const SEARCH_ITEM_MAX = 60;

/** 仅接受形状合法且未过期的完整搜索快照，限制恢复数量。 */
export function normalizeSearchSnapshot(value: unknown, now = Date.now()): SearchSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Partial<SearchSnapshot>;
  if (typeof s.keyword !== 'string' || !s.keyword.trim() || !Array.isArray(s.items) || !Array.isArray(s.statuses)) return null;
  if (typeof s.savedAt !== 'number' || !Number.isFinite(s.savedAt) || now - s.savedAt > SEARCH_TTL || s.savedAt > now + 60000) return null;
  return { ...s, keyword: s.keyword, items: s.items.slice(0, SEARCH_ITEM_MAX), totalMs: typeof s.totalMs === 'number' ? s.totalMs : 0, scrollY: Math.max(0, s.scrollY ?? 0) } as SearchSnapshot;
}
