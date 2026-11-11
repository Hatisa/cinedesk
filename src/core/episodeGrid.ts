/**
 * 选集网格的列数自适应。
 *
 * 采集源的剧集名长度差别极大：正片多是「第01集」，综艺/动画则会给出
 * 「第20260626期下」「程璐回应鸟鸟升咖」这类十几个字的标题。固定 5 列时
 * 这些标题被省略号截断，用户看不出是哪一期。
 *
 * 做法：取标题宽度的 90 分位作为「一行放得下」的目标宽度，再按容器算列数。
 * 用分位而不是最大值，是为了避免某一集特别长的标题（花絮、特辑）把整页
 * 一百多集压成两列；超出的那几条会在按钮内换行，一个字都不会被截掉。
 * 列数确定后整行等宽，网格保持对齐；短标题（第01集）仍是 5 列，观感不变。
 */

/** 与 styles.css 里 .ep-grid 的 gap 保持一致 */
export const EP_GAP = 8;

/** 按钮左右内边距 12px + 左右描边 2px + 2px 富余 */
const BUTTON_CHROME = 16;

/** 短标题的下限宽度：再窄也会保持 5 列，不会因为自适应变得过密 */
const MIN_BUTTON_WIDTH = 64;

const MAX_COLUMNS = 5;
const MIN_COLUMNS = 2;

/** 目标宽度：能覆盖 90% 标题的最小值 */
function targetWidth(widths: number[]): number {
  const sorted = [...widths].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(0.9 * (sorted.length - 1)));
  return sorted[index];
}

/**
 * @param textWidths 每个剧集名的实测文本宽度（px，不含内边距）
 * @param containerWidth 网格的可用净宽
 */
export function episodeColumnCount(textWidths: number[], containerWidth: number, gap = EP_GAP): number {
  if (textWidths.length === 0 || !(containerWidth > 0)) return 0;
  const need = Math.max(MIN_BUTTON_WIDTH, targetWidth(textWidths) + BUTTON_CHROME);
  const columns = Math.floor((containerWidth + gap) / (need + gap));
  return Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, columns));
}
