import type { AggregatedItem, VodItem } from './types';

/** 空字符串表示不限制；year 另支持 upcoming / older。 */
export interface SearchFilters {
  type: string;
  area: string;
  year: string;
}

export const EMPTY_SEARCH_FILTERS: Readonly<SearchFilters> = Object.freeze({ type: '', area: '', year: '' });

export const SEARCH_TYPES = ['剧情', '喜剧', '动作', '爱情', '科幻', '动画', '悬疑', '惊悚', '恐怖', '犯罪', '战争', '历史', '古装', '奇幻', '冒险', '纪录', '家庭'] as const;
export const SEARCH_AREAS = ['内地', '中国香港', '中国台湾', '美国', '韩国', '日本', '欧洲', '印度', '泰国'] as const;

const AREA_ALIASES: Record<string, string[]> = {
  内地: ['内地', '大陆', '中国', '中国大陆', '中国内地'],
  中国香港: ['香港', '中国香港'],
  中国台湾: ['台湾', '中国台湾'],
  美国: ['美国', '美國', 'USA'],
  韩国: ['韩国', '韓國'],
  日本: ['日本'],
  欧洲: ['英国', '法国', '德国', '意大利', '西班牙', '俄罗斯', '欧洲', '英國', '法國', '德國', '俄羅斯'],
  印度: ['印度'],
  泰国: ['泰国', '泰國'],
};

/** 当前年份来自设备日期，选项随新一年自动前移。 */
export function searchYearOptions(now = new Date()): string[] {
  return Array.from({ length: 6 }, (_, i) => String(now.getFullYear() - i));
}

/** 拆分接口里使用斜杠、顿号或逗号拼接的分类，不依赖某一个源的固定写法。 */
function tags(value: string): string[] {
  return value.split(/[\/、,，|·]+/).map((s) => s.trim()).filter(Boolean);
}

function matchesType(item: VodItem, type: string): boolean {
  if (!type) return true;
  return tags(item.typeName).some((tag) => tag === type || tag.startsWith(type));
}

function matchesArea(item: VodItem, area: string): boolean {
  if (!area) return true;
  const actual = tags(item.area);
  return AREA_ALIASES[area]?.some((alias) => actual.some((tag) => tag === alias)) ?? false;
}

function matchesYear(item: VodItem, year: string, currentYear: number): boolean {
  if (!year) return true;
  const value = Number(item.year);
  if (!Number.isInteger(value)) return false;
  if (year === 'upcoming') return value > currentYear;
  if (year === 'older') return value < currentYear - 5;
  return item.year === year;
}

export function matchesSearchFilters(item: VodItem, filters: SearchFilters, now = new Date()): boolean {
  const currentYear = now.getFullYear();
  return matchesType(item, filters.type) && matchesArea(item, filters.area) && matchesYear(item, filters.year, currentYear);
}

/** 同一来源副本须同时满足三个条件，不能把不同版本的元数据拼接成命中。 */
export function filterSearchItems(items: AggregatedItem[], filters: SearchFilters, now = new Date()): AggregatedItem[] {
  if (isSearchFiltersEmpty(filters)) return items;
  return items.filter((item) => item.variants.some((variant) => matchesSearchFilters(variant, filters, now)));
}

export function isSearchFiltersEmpty(filters: SearchFilters): boolean {
  return !filters.type && !filters.area && !filters.year;
}

export function normalizeSearchFilters(value: unknown): SearchFilters {
  if (!value || typeof value !== 'object') return { ...EMPTY_SEARCH_FILTERS };
  const input = value as Partial<SearchFilters>;
  const text = (field: unknown) => typeof field === 'string' && field.length <= 12 ? field : '';
  const year = text(input.year);
  return {
    type: text(input.type),
    area: text(input.area),
    year: year === 'upcoming' || year === 'older' || /^\d{4}$/.test(year) ? year : '',
  };
}
