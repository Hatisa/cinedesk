import type { AggregatedItem, VodItem } from './types.ts';

export interface PlayRoute { source: string; vodId?: string; line: number; ep: number }
export interface PlaySelection { variantIdx: number; lineIdx: number; epIdx: number }

export function nonNegativeInt(value: string | null, fallback = 0): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
export function findVariant(item: AggregatedItem, route: Pick<PlayRoute, 'source' | 'vodId'>, legacyLine = -1): number {
  if (route.vodId) {
    const exact = item.variants.findIndex((v) => v.sourceKey === route.source && v.vodId === route.vodId);
    if (exact >= 0) return exact;
  }
  const bySource = item.variants.findIndex((v) => v.sourceKey === route.source);
  if (bySource >= 0) return bySource;
  return !route.source && item.variants[legacyLine] ? legacyLine : 0;
}
export function selectionFor(item: AggregatedItem, route: PlayRoute): PlaySelection {
  const variantIdx = findVariant(item, route);
  const current = item.variants[variantIdx];
  const lineIdx = current ? Math.max(0, Math.min(route.line, current.lines.length - 1)) : 0;
  const epTotal = current?.lines[lineIdx]?.episodes.length ?? 1;
  return { variantIdx, lineIdx, epIdx: Math.min(route.ep, Math.max(0, epTotal - 1)) };
}
export function moveSelection(item: AggregatedItem, selection: PlaySelection, patch: Partial<PlaySelection>): PlaySelection {
  const variantIdx = Math.max(0, Math.min(patch.variantIdx ?? selection.variantIdx, item.variants.length - 1));
  const current = item.variants[variantIdx];
  const lineIdx = Math.max(0, Math.min(patch.lineIdx ?? selection.lineIdx, (current?.lines.length ?? 1) - 1));
  const epTotal = current?.lines[lineIdx]?.episodes.length ?? 1;
  return { variantIdx, lineIdx, epIdx: Math.max(0, Math.min(patch.epIdx ?? selection.epIdx, Math.max(0, epTotal - 1))) };
}
export function playPath(item: AggregatedItem, selection: PlaySelection): string {
  const v = item.variants[selection.variantIdx];
  return `/play/${encodeURIComponent(item.key)}?name=${encodeURIComponent(item.name)}&source=${encodeURIComponent(v?.sourceKey ?? '')}&vod=${encodeURIComponent(v?.vodId ?? '')}&line=${selection.lineIdx}&ep=${selection.epIdx}`;
}
const failureKey = (v: VodItem | undefined, line: number) => `${v?.sourceKey}:${v?.vodId}:${line}`;
export function nextPlayable(item: AggregatedItem, selection: PlaySelection, failed: Set<string>): PlaySelection | null {
  const v = item.variants[selection.variantIdx];
  if (v && selection.lineIdx + 1 < v.lines.length && !failed.has(failureKey(v, selection.lineIdx + 1))) {
    return moveSelection(item, selection, { lineIdx: selection.lineIdx + 1 });
  }
  for (let offset = 1; offset < item.variants.length; offset++) {
    const index = (selection.variantIdx + offset) % item.variants.length;
    if (!failed.has(failureKey(item.variants[index], 0))) return moveSelection(item, selection, { variantIdx: index, lineIdx: 0 });
  }
  return null;
}
export { failureKey };
