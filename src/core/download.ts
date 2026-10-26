/**
 * 分片下载引擎。
 *
 * 把一集的 HLS 流下载成本地文件。要点：
 *
 * - **并发**：分片数常达数百（实测某集 629 片），串行下载慢到不可用。
 *   这里用固定数量的 worker 抢任务，而不是一次性发全部请求——
 *   后者会把连接池和内存打满。
 * - **断点续传**：下载前先看分片是否已在本地，在就跳过。这样中断后
 *   （切后台被杀、断网、手动暂停）重来只补缺失的部分，不会从头再来。
 * - **重试**：源站分片偶发 502/超时是常态，单片重试数次再判失败。
 * - **取消**：通过 AbortSignal 中止，已下载的分片保留，便于续传。
 * - **加密**：实测 8 个主要片源里 6 个是 AES-128 加密（猫眼/光速/极速/
 *   红牛/虎牙/速播），只有暴风、最大资源是明文。「遇到加密就拒绝缓存」
 *   等于缓存功能对多数片源直接失效。这里在下载时就解密，本地落盘的是
 *   明文分片，离线播放因此与明文片源走完全相同的路径。
 *
 * 下载只落分片文件，不落播放列表：播放列表在播放时现生成，
 * 因为分片地址含运行时的本地服务地址（换设备/换版本会变），
 * 固化进文件会导致离线播放全部 404。
 */
// 相对导入必须带 .ts 扩展名：这些模块会被 node --test 直接加载，
// Node 的 ESM 解析不做扩展名补全（与 Vite 的行为不同）。
import { aes128CbcDecrypt, parseIv } from './aes.ts';
import { sizeOf, writeBinary } from './fs.ts';
import { httpGetBinary, httpGetText } from './http.ts';
import {
  extOf,
  isMaster,
  pad,
  parseMaster,
  parseMedia,
  pickVariant,
  type LocalSegment,
  type Media,
} from './m3u8.ts';

/** 缓存画质偏好 */
export type Quality = 'high' | 'mid' | 'low';

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_RETRIES = 3;
const FETCH_TIMEOUT = 20000;

export interface EpisodeDownloadOpts {
  /** 相对缓存根目录的该集目录，如 "庆余年 第一季/第001集" */
  dir: string;
  quality: Quality;
  /** 进度回调：已完成分片数 / 总分片数 / 累计字节 */
  onProgress?: (done: number, total: number, bytes: number) => void;
  signal?: AbortSignal;
  concurrency?: number;
  retries?: number;
  /** 依赖注入，仅测试使用 */
  deps?: DownloadDeps;
}

export interface EpisodeDownloadResult {
  segments: LocalSegment[];
  bytes: number;
  duration: number;
}

/**
 * 下载所依赖的外部能力。
 * 抽出来是为了能注入假实现做测试——断点续传、并发上限、取消这些
 * 行为光靠肉眼看不出来，必须有测试锁住。
 */
export interface DownloadDeps {
  getText: (url: string) => Promise<{ ok: boolean; status: number; text: string; error?: string }>;
  getBinary: (url: string) => Promise<{ ok: boolean; status: number; data: ArrayBuffer | null; error?: string }>;
  sizeOf: (path: string) => Promise<number>;
  writeBinary: (path: string, data: ArrayBuffer) => Promise<void>;
}

const realDeps: DownloadDeps = {
  getText: (url) => httpGetText(url, FETCH_TIMEOUT),
  getBinary: (url) => httpGetBinary(url, FETCH_TIMEOUT),
  sizeOf,
  writeBinary,
};

/**
 * 解析播放列表，拿到最终的分片清单。
 * 传进来的是 master 就先按画质选档，再取该档的 media 列表。
 */
export async function resolveMedia(
  srcUrl: string,
  quality: Quality,
  deps: DownloadDeps = realDeps,
): Promise<Media> {
  const first = await deps.getText(srcUrl);
  if (!first.ok || !first.text) {
    throw new Error(first.error || `播放列表获取失败（HTTP ${first.status}）`);
  }
  if (!isMaster(first.text)) return parseMedia(first.text, srcUrl);

  const variants = parseMaster(first.text, srcUrl);
  const picked = pickVariant(variants, quality);
  if (!picked) throw new Error('播放列表里没有可用清晰度');

  const sub = await deps.getText(picked.url);
  if (!sub.ok || !sub.text) {
    throw new Error(sub.error || `清晰度列表获取失败（HTTP ${sub.status}）`);
  }
  return parseMedia(sub.text, picked.url);
}

/**
 * 下载一集的全部分片。
 * 抛错表示这一集失败；已写入的分片会保留，重试时自动跳过。
 */
export async function downloadEpisode(
  srcUrl: string,
  opts: EpisodeDownloadOpts,
): Promise<EpisodeDownloadResult> {
  const { dir, quality, onProgress, signal } = opts;
  const deps = opts.deps ?? realDeps;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const retries = Math.max(0, opts.retries ?? DEFAULT_RETRIES);

  const media = await resolveMedia(srcUrl, quality, deps);
  if (media.live) throw new Error('直播源无法缓存');
  if (!media.segments.length) throw new Error('播放列表里没有分片');

  const total = media.segments.length;
  // 集内序号零填充，保证文件管理器里也是播出顺序
  const names = media.segments.map((s, i) => `seg-${pad(i + 1, 6)}${extOf(s.url)}`);

  // 密钥按 URL 缓存：一部剧几十上百集共用同一个密钥，
  // 每片都去取一次密钥会让请求数翻倍，还容易被源站限流。
  //
  // 缓存的是 Promise 而不是结果：worker 是并发的，4 个 worker 同时开工时
  // 若只缓存已完成的密钥，它们会各自发起一次请求（实测正是如此），
  // 缓存 Promise 才能让并发者共享同一次请求。
  const keyCache = new Map<string, Promise<ArrayBuffer>>();

  const getKey = (url: string): Promise<ArrayBuffer> => {
    const hit = keyCache.get(url);
    if (hit) return hit;
    const p = fetchWithRetry(url, retries, deps, signal);
    keyCache.set(url, p);
    // 取密钥失败后不能把这个失败的 Promise 永久留在缓存里，
    // 否则重试整集时会一直拿到同一个失败结果。
    p.catch(() => keyCache.delete(url));
    return p;
  };

  let cursor = 0;
  let done = 0;
  let bytes = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) throw new DOMException('下载已取消', 'AbortError');
      const i = cursor;
      cursor += 1;
      if (i >= total) return;

      const seg = media.segments[i];
      const rel = `${dir}/${names[i]}`;
      // 断点续传：已在本地就直接计入，不重复下载。
      // 用 sizeOf 而非 exists 判定，省一次调用，且能顺带累加字节数。
      const existing = await deps.sizeOf(rel);
      if (existing > 0) {
        bytes += existing;
      } else {
        let buf = await fetchWithRetry(seg.url, retries, deps, signal);
        if (seg.keyUrl) {
          // HLS 的默认 IV 是「该分片的媒体序号」，因此要用起始序号加下标
          const iv = parseIv(seg.keyIv ?? null, media.mediaSequence + i);
          buf = await aes128CbcDecrypt(await getKey(seg.keyUrl), iv, buf);
        }
        await deps.writeBinary(rel, buf);
        bytes += buf.byteLength;
      }
      done += 1;
      onProgress?.(done, total, bytes);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));

  const segments: LocalSegment[] = names.map((name, i) => ({
    name,
    duration: media.segments[i].duration,
  }));
  return { segments, bytes, duration: media.totalDuration };
}

/** 单个分片的下载与重试；重试之间退避，避免源站被连续打 */
async function fetchWithRetry(
  url: string,
  retries: number,
  deps: DownloadDeps,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  let last = '';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw new DOMException('下载已取消', 'AbortError');
    const res = await deps.getBinary(url);
    if (res.ok && res.data && res.data.byteLength > 0) return res.data;
    last = res.error || `HTTP ${res.status}`;
    if (attempt < retries) await sleep(300 * (attempt + 1));
  }
  throw new Error(`分片下载失败：${last}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 人类可读的体积文案 */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
