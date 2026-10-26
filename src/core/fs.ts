/**
 * 缓存的文件系统层。
 *
 * 缓存目录选应用私有空间（Directory.Data），而不是公共的 Documents：
 * 私有目录不需要任何存储权限，卸载 App 会自动清理，也不会被其他应用
 * 或系统的媒体扫描器翻出来。这是主流视频 App 的通行做法。
 *
 * 注意 writeFile 的二进制陷阱：**不传 encoding 时，插件把 data 当作
 * base64 解码后写入**。所以二进制分片必须传 base64 字符串；传原文
 * 或 ArrayBuffer 都会写出损坏的文件，且不会报错。
 *
 * 为什么每个调用都套一层超时：Filesystem 是原生插件，回调不来时 JS 侧的
 * Promise **既不 resolve 也不 reject**。真机上这会让下载永远停在「准备中」，
 * 且用户看不到任何错误、也无从重试。套上兜底后最坏情况也会变成一条
 * 明确的失败原因。探测结论见 download.ts 文件头的说明。
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { withDeadline } from './deadline.ts';

/** 缓存根目录名（位于 Directory.Data 之内） */
export const CACHE_ROOT = 'cinedesk';

/**
 * 文件插件调用的兜底超时。
 * 写入一片（几百 KB）正常是毫秒级；20 秒还没回来只可能是卡死。
 */
const FS_TIMEOUT = 20000;

/** 缓存只在原生 App 里可用；浏览器端没有可写的私有目录 */
export function cacheSupported(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** ArrayBuffer → base64（分块处理，避免大分片触发参数长度上限） */
export function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let raw = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    raw += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(raw);
}

/** base64 → ArrayBuffer */
export function base64ToBuf(b64: string): ArrayBuffer {
  // 原生返回的 base64 可能带换行与空白，必须先清掉再解码
  const clean = b64.replace(/[\s\r\n]/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function ensureDir(path: string): Promise<void> {
  try {
    await withDeadline(
      Filesystem.mkdir({ path, directory: Directory.Data, recursive: true }),
      FS_TIMEOUT,
      '创建目录',
    );
  } catch {
    // 已存在时插件会抛错，这里忽略；真正的失败会在后续写入时暴露
  }
}

/** 写入二进制文件（内部转 base64，见文件头说明） */
export async function writeBinary(path: string, data: ArrayBuffer): Promise<void> {
  const full = `${CACHE_ROOT}/${path}`;
  await withDeadline(
    Filesystem.writeFile({
      path: full,
      data: bufToBase64(data),
      directory: Directory.Data,
      recursive: true,
    }),
    FS_TIMEOUT,
    '写入分片',
  );
}

/** 写入文本文件（播放列表） */
export async function writeText(path: string, text: string): Promise<void> {
  await withDeadline(
    Filesystem.writeFile({
      path: `${CACHE_ROOT}/${path}`,
      data: text,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    }),
    FS_TIMEOUT,
    '写入文件',
  );
}

/** 读取文本文件；不存在返回 null */
export async function readText(path: string): Promise<string | null> {
  try {
    const res = await withDeadline(
      Filesystem.readFile({
        path: `${CACHE_ROOT}/${path}`,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      }),
      FS_TIMEOUT,
      '读取文件',
    );
    return typeof res.data === 'string' ? res.data : null;
  } catch {
    return null;
  }
}

/** 读取二进制文件；不存在返回 null */
export async function readBinary(path: string): Promise<ArrayBuffer | null> {
  try {
    const res = await withDeadline(
      Filesystem.readFile({
        path: `${CACHE_ROOT}/${path}`,
        directory: Directory.Data,
      }),
      FS_TIMEOUT,
      '读取文件',
    );
    if (typeof res.data === 'string') return base64ToBuf(res.data);
    return null;
  } catch {
    return null;
  }
}

/** 文件是否存在 */
export async function exists(path: string): Promise<boolean> {
  try {
    await withDeadline(
      Filesystem.stat({ path: `${CACHE_ROOT}/${path}`, directory: Directory.Data }),
      FS_TIMEOUT,
      '查询文件',
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 文件大小（字节）；不存在返回 0。
 *
 * 这是下载热路径上的第一次文件插件调用（断点续传判定）。
 *
 * 注意「文件不存在」与「插件无响应」必须区分开：
 *   - 不存在（正常的首次下载）→ 返回 0，继续下载；
 *   - 超时（插件卡死）→ **抛出**。若也返回 0，477 个分片会各卡 20 秒，
 *     用户看到的是「进度一动不动、没有任何报错」，比直接失败更糟。
 */
export async function sizeOf(path: string): Promise<number> {
  try {
    const s = await withDeadline(
      Filesystem.stat({ path: `${CACHE_ROOT}/${path}`, directory: Directory.Data }),
      FS_TIMEOUT,
      '查询本地文件',
    );
    return s.size ?? 0;
  } catch (e) {
    if (isTimeout(e)) throw e;
    return 0;
  }
}

/** 是否为兜底超时抛出的错误（区别于插件自身的「文件不存在」等业务错误） */
function isTimeout(e: unknown): boolean {
  return e instanceof Error && e.message.includes('超时');
}

/** 递归删除某剧的整个目录 */
export async function removeDir(path: string): Promise<void> {
  try {
    await withDeadline(
      Filesystem.rmdir({
        path: `${CACHE_ROOT}/${path}`,
        directory: Directory.Data,
        recursive: true,
      }),
      FS_TIMEOUT,
      '删除目录',
    );
  } catch {
    // 目录本就不存在时无需处理
  }
}

/**
 * 把设备路径转成 WebView 能取到的地址。
 * 返回的地址由 Capacitor 本地文件服务处理，且支持 Range 请求（拖动需要）。
 */
export async function localUrlOf(path: string): Promise<string | null> {
  try {
    const { uri } = await withDeadline(
      Filesystem.getUri({
        path: `${CACHE_ROOT}/${path}`,
        directory: Directory.Data,
      }),
      FS_TIMEOUT,
      '解析本地地址',
    );
    return Capacitor.convertFileSrc(uri);
  } catch {
    return null;
  }
}

export { ensureDir };
