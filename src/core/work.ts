import { normalizeName } from './filter.ts';
import type { AggregatedItem, VodItem } from './types';

/** 可用于区分重映/翻拍版本的完整年份；空值和异常年份不当作身份依据。 */
export function validYear(value: string | undefined): string {
  const year = String(value ?? '').trim();
  if (!/^\d{4}$/.test(year)) return '';
  const n = Number(year);
  return n >= 1888 && n <= new Date().getFullYear() + 2 ? year : '';
}

export function workKeyFor(input: { name: string; year?: string }): string {
  const title = normalizeName(input.name);
  const year = validYear(input.year);
  return `${title}${year ? `~${year}` : ''}`;
}

export function workVariantKey(item: Pick<VodItem, 'name' | 'year' | 'sourceKey' | 'vodId'>): string {
  return `${workKeyFor(item)}~${item.sourceKey}:${item.vodId}`;
}

/** 旧版收藏只存片名归一化键；保留其来源和 vodId，仅补入已保存的年份。 */
export function upgradeSavedWorkKey<T extends { key: string; name: string; year?: string }>(entry: T): T {
  if (entry.key !== workKeyFor({ name: entry.name })) return entry;
  const key = workKeyFor(entry);
  return key === entry.key ? entry : { ...entry, key };
}

export function compatibleWork(
  a: { name: string; year?: string },
  b: { name: string; year?: string },
): boolean {
  if (normalizeName(a.name) !== normalizeName(b.name)) return false;
  const ay = validYear(a.year);
  const by = validYear(b.year);
  return !ay || !by || ay === by;
}

/** 同源不同 vod_id 即便同名同年也保留为两个版本，避免静默丢片。 */
export function canAddVariant(agg: AggregatedItem, item: VodItem): boolean {
  return !agg.variants.some(
    (v) => v.sourceKey === item.sourceKey && v.vodId !== item.vodId,
  );
}

export interface SavedWork {
  key: string;
  name: string;
  year?: string;
  sourceKey: string;
  vodId: string;
}

/** 收藏/历史的精确元数据优先；旧版仅存片名的数据仍可按兼容身份找回。 */
export function matchesSavedWork(item: AggregatedItem, saved: SavedWork): boolean {
  if (!compatibleWork(item, saved)) return false;
  const sameSource = item.variants.filter((v) => v.sourceKey === saved.sourceKey);
  return !sameSource.length || sameSource.some((v) => v.vodId === saved.vodId);
}

export function findSavedVariant(item: AggregatedItem, saved: SavedWork): number {
  const exact = item.variants.findIndex(
    (v) => v.sourceKey === saved.sourceKey && v.vodId === saved.vodId,
  );
  return exact >= 0 ? exact : item.variants.findIndex((v) => v.sourceKey === saved.sourceKey);
}

/** 相关度优先于热度：精确片名不应被高分或收录源更多的衍生作品挤下去。 */
export function titleRelevance(name: string, keyword: string): number {
  const title = normalizeName(name);
  const query = normalizeName(keyword);
  if (!title || !query) return 3;
  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  if (title.includes(query)) return 2;
  return 3;
}
