import type { AggregatedItem } from './types';

/** 解说、预告等衍生视频不是正片，默认收起但仍允许用户手动查看。 */
export function isDerivative(item: Pick<AggregatedItem, 'name' | 'typeName'>): boolean {
  return /解说|预告|花絮|剪辑|片段|幕后|影评|速看|盘点|杀青|发布会|主题曲/i.test(item.name)
    || /解说|预告|花絮|资讯|短片/i.test(item.typeName);
}

export type SeriesGroup = { kind: 'series'; key: string; name: string; items: AggregatedItem[] };
export type SearchEntry = { kind: 'item'; key: string; item: AggregatedItem } | SeriesGroup;

/**
 * 只折叠明确的季、特别篇标记，避免把名字相近的不同作品误并为系列。
 * 每组内部保留聚合排序，组的位置由组内最佳作品决定。
 */
export function groupSeries(items: AggregatedItem[]): SearchEntry[] {
  const groups = new Map<string, AggregatedItem[]>();
  const singles: AggregatedItem[] = [];
  for (const item of items) {
    const match = item.name.match(/^(.*?)(?:第\s*[一二三四五六七八九十百0-9]+\s*[季部]|特别篇|特别版|SP)(?:.*)$/i);
    const base = match?.[1].replace(/[\s:：\-—_·]+$/g, '').trim();
    if (!base || base.length < 2) singles.push(item);
    else groups.set(base, [...(groups.get(base) ?? []), item]);
  }
  const entries: SearchEntry[] = singles.map((item) => ({ kind: 'item', key: item.key, item }));
  for (const [name, members] of groups) {
    if (members.length < 2) entries.push({ kind: 'item', key: members[0].key, item: members[0] });
    else entries.push({ kind: 'series', key: `series:${name}`, name, items: members });
  }
  const firstPosition = new Map(items.map((item, index) => [item.key, index]));
  return entries.sort((a, b) => {
    const first = (entry: SearchEntry) => firstPosition.get(entry.kind === 'item' ? entry.item.key : entry.items[0].key) ?? 0;
    return first(a) - first(b);
  });
}

/** 空结果时优先给相近的近期搜索，再补充实时榜单，点击即可重新搜索。 */
export function searchSuggestions(keyword: string, recent: string[], trending: string[], limit = 6): string[] {
  const kw = keyword.replace(/\s+/g, '').toLowerCase();
  const ranked = [...recent, ...trending].filter((title, index, all) => {
    const normalized = title.replace(/\s+/g, '').toLowerCase();
    return title !== keyword && normalized && all.indexOf(title) === index
      && (normalized.includes(kw) || kw.includes(normalized) || !kw);
  });
  const fallback = [...recent, ...trending].filter((title) => title !== keyword && !ranked.includes(title));
  return [...ranked, ...fallback].filter((title, index, all) => all.indexOf(title) === index).slice(0, limit);
}
