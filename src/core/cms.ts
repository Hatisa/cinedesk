/**
 * 苹果 CMS（MacCMS）vod 协议解析。
 *
 * 接口形态：
 *   GET {api}?ac=videolist&wd=关键词
 *   -> { code:1, list:[ { vod_id, vod_name, vod_play_from, vod_play_url, ... } ] }
 *
 * vod_play_from 与 vod_play_url 都用 `$$$` 分隔多条线路；
 * 每条线路内部用 `#` 分隔集数；每集用 `$` 分隔「集名」与「地址」。
 * 例： vod_play_from = "jsyun$$$jsm3u8"
 *      vod_play_url  = "第01集$https://a/play/xxx#第02集$...$$$第01集$https://b/x.m3u8#..."
 */
import { classifyContent } from './filter.ts';
import type { Episode, PlayLine, RawVod, RawVodResponse, SourceConfig, VodItem } from './types.ts';

const SEP_LINE = '$$$';
const SEP_EPISODE = '#';
const SEP_NAME_URL = '$';

/** 从任意响应外壳中取出条目数组，兼容 list / data.list 两种封装 */
export function extractList(payload: unknown): RawVod[] {
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as RawVodResponse & { data?: RawVodResponse };
  const candidates = [obj.list, obj.data?.list];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as RawVod[];
  }
  return [];
}

/** 解析 vod_play_from / vod_play_url，得到线路列表 */
export function parsePlayLines(raw: RawVod): PlayLine[] {
  const froms = (raw.vod_play_from || '').split(SEP_LINE);
  const groups = (raw.vod_play_url || '').split(SEP_LINE);
  const lines: PlayLine[] = [];

  for (let i = 0; i < groups.length; i++) {
    const groupRaw = groups[i];
    if (!groupRaw || !groupRaw.trim()) continue;

    const episodes: Episode[] = [];
    for (const chunk of groupRaw.split(SEP_EPISODE)) {
      if (!chunk || !chunk.trim()) continue;
      // 地址本身可能包含 '$'，因此只按第一个分割
      const at = chunk.indexOf(SEP_NAME_URL);
      if (at < 0) continue;
      const name = chunk.slice(0, at).trim();
      const url = chunk.slice(at + 1).trim();
      if (!/^https?:\/\//i.test(url)) continue;
      episodes.push({
        index: episodes.length,
        name: name || `第${episodes.length + 1}集`,
        url,
      });
    }
    if (!episodes.length) continue;

    lines.push({
      name: (froms[i] || `线路${i + 1}`).trim(),
      episodes,
      direct: isDirectUrl(episodes[0].url),
    });
  }

  // 直链线路优先，用户点开即能播放
  lines.sort((a, b) => Number(b.direct) - Number(a.direct));
  return lines;
}

/** 判断地址是否可直接交给播放器（HLS / MP4） */
export function isDirectUrl(url: string): boolean {
  return /\.(m3u8|mp4|flv)(\?|#|$)/i.test(url);
}

/**
 * 把原始条目转为内部模型。
 * 返回 null 表示这条不该出现在结果里（无片名、命中内容过滤、无可用线路）。
 */
export function toVodItem(raw: RawVod, source: SourceConfig): VodItem | null {
  const name = cleanName(raw.vod_name);
  if (!name) return null;

  const parseScore = (value: string | number | undefined) => {
    const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const doubanScore = parseScore(raw.vod_douban_score);
  const siteScore = parseScore(raw.vod_score);
  const safeScore = doubanScore || siteScore;

  /*
   * 内容甄别在建线路之前做，成人条目连解析播放地址的开销都省掉。
   * 分类文本要同时喂 vod_class 与 type_name：前者常是「剧情,古装,内地剧」
   * 这样的多值串（可能藏着短剧标记），后者是主分类。
   */
  const classText = [raw.vod_class, raw.type_name].filter(Boolean).join(' ');
  const verdict = classifyContent({ name, classText, score: doubanScore });
  if (verdict.adult) return null;

  const lines = parsePlayLines(raw);
  if (!lines.length) return null;
  // 没有任何直链线路的条目会点开才发现放不了，直接丢弃以保证「点开即播」
  if (!lines.some((l) => l.direct)) return null;

  return {
    sourceKey: source.key,
    sourceName: source.name,
    vodId: String(raw.vod_id ?? ''),
    name,
    pic: (raw.vod_pic || '').trim(),
    remarks: (raw.vod_remarks || '').trim(),
    year: String(raw.vod_year || '').trim(),
    area: (raw.vod_area || '').trim(),
    typeName: (raw.vod_class || raw.type_name || '').trim(),
    score: safeScore,
    scoreSource: safeScore ? (doubanScore ? 'douban' : 'site') : null,
    actor: cleanPeople(raw.vod_actor),
    director: cleanPeople(raw.vod_director),
    content: stripHtml(raw.vod_content || ''),
    lines,
    shortDrama: verdict.shortDrama,
  };
}

/** 资源站原始文本可能带分隔符或尾逗号，只清理边缘，不吞掉正文。 */
export function cleanName(value: string | undefined): string {
  return (value || '').trim().replace(/\s*\$\s*/g, ' / ');
}

export function cleanPeople(value: string | undefined): string {
  return (value || '').trim().replace(/^[，,\s]+|[，,\s]+$/g, '');
}

/** 简介常带 <p> 等标签，清理后展示 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
