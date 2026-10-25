/**
 * 内容过滤与名称归一化。
 *
 * 第一道防线是内置源白名单（sources.ts），这里提供第二道：
 * 过滤掉命中成人关键词的条目，避免搜索结果里出现不想看到的内容。
 */

/**
 * 高置信度成人关键词。
 * 刻意不使用 'av'、'91' 这类短词——它们会误伤 Avatar、91天 等正常片名。
 */
const BLOCKED_WORDS = [
  '成人片',
  '成人影视',
  '成人电影',
  '色情',
  '里番',
  '无码',
  '有码',
  '三级片',
  '做爱',
  '性爱',
  '裸聊',
  '约炮',
  '福利姬',
  '麻豆传媒',
  'porn',
  'hentai',
  'javbus',
  '淫',
  '嫖',
];

/** 判断文本是否应被过滤 */
export function isBlocked(...texts: (string | undefined)[]): boolean {
  const s = texts.filter(Boolean).join(' ').toLowerCase();
  if (!s) return false;
  return BLOCKED_WORDS.some((w) => s.includes(w));
}

/**
 * 归一化片名，用于跨源聚合去重。
 * 去掉空白与常见标点，统一全角/大小写，使「庆余年 第二季」与「庆余年第二季」归为同一条。
 */
export function normalizeName(name: string): string {
  return name
    .replace(/\s+/g, '')
    .replace(/[·・:：\-—_~～，,。.！!？?《》<>()（）\[\]【】{}'"“”‘’`|/\\*+]/g, '')
    .toLowerCase();
}

/** 把「更新至36集」「HD国语」「已完结」等备注压缩为简短标签 */
export function shortRemarks(remarks: string): string {
  const r = (remarks || '').trim();
  if (!r) return '';
  return r.length > 12 ? r.slice(0, 12) : r;
}
