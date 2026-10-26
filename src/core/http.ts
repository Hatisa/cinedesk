/**
 * HTTP 通道。
 *
 * 这是整个 App 能「零服务器」运行的关键：
 *
 * - 在 Android APK 里，CapacitorHttp 会把 fetch / XMLHttpRequest 的跨域请求
 *   转交给原生 OkHttp 发出。原生请求不受浏览器同源策略约束，因此
 *   资源站的 CORS 限制、运营商 Referer 校验都不再是问题——不需要任何代理服务器。
 * - 在浏览器里开发调试时，退回到 Vite 的 /__proxy 中间件转发，便于本地联调。
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';

const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

export interface HttpResult {
  ok: boolean;
  status: number;
  text: string;
  /** 耗时（毫秒） */
  ms: number;
  error?: string;
}

const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/**
 * 发起一次 GET 请求并返回文本。
 * 网络错误、超时都不会抛出——统一以 ok=false 返回，由调用方决定降级策略。
 */
export async function httpGetText(
  url: string,
  timeoutMs = 12000,
  extraHeaders: Record<string, string> = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    ...extraHeaders,
  };
  const t0 = Date.now();

  // 1) 原生平台：走 OkHttp，彻底绕过 CORS
  if (isNative()) {
    try {
      const res = await CapacitorHttp.get({
        url,
        headers,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
        responseType: 'text',
      });
      const text =
        typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        text,
        ms: Date.now() - t0,
      };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        text: '',
        ms: Date.now() - t0,
        error: errText(e),
      };
    }
  }

  // 2) 浏览器开发环境：走 Vite 中间件转发，绕开 CORS
  const target = import.meta.env.DEV
    ? `${location.origin}/__proxy?url=${encodeURIComponent(url)}`
    : url;

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(target, { headers, signal: ctl.signal });
    clearTimeout(timer);
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, text: '', ms: Date.now() - t0, error: errText(e) };
  }
}

function errText(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as { cause?: { code?: string } }).cause;
    if (cause?.code) return cause.code;
    return e.name === 'AbortError' ? 'timeout' : e.message;
  }
  return String(e);
}

/** 发起 GET 并尝试解析为 JSON，失败返回 null（不会抛错） */
export async function httpGetJson<T = unknown>(
  url: string,
  timeoutMs = 12000,
  extraHeaders: Record<string, string> = {},
): Promise<{ json: T | null; result: HttpResult }> {
  const result = await httpGetText(url, timeoutMs, extraHeaders);
  if (!result.ok || !result.text) return { json: null, result };
  try {
    return { json: JSON.parse(result.text) as T, result };
  } catch {
    return { json: null, result };
  }
}

/**
 * 发起 GET 并返回二进制内容。
 *
 * 注意：Android 上 CapacitorHttp 的 arraybuffer 响应实际是 base64 字符串，
 * 必须解码后才是真正的字节——直接当 ArrayBuffer 用会写出损坏文件。
 * 这里与 hlsLoader 的处理保持一致。
 */
export async function httpGetBinary(
  url: string,
  timeoutMs = 20000,
  extraHeaders: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; data: ArrayBuffer | null; error?: string }> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: '*/*',
    ...extraHeaders,
  };

  if (isNative()) {
    try {
      const res = await CapacitorHttp.get({
        url,
        headers,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
        responseType: 'arraybuffer',
      });
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, status: res.status, data: null };
      }
      const raw = typeof res.data === 'string' ? res.data : '';
      return { ok: true, status: res.status, data: raw ? b64ToBuf(raw) : null };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: errText(e) };
    }
  }

  const target = import.meta.env.DEV
    ? `${location.origin}/__proxy?url=${encodeURIComponent(url)}`
    : url;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(target, { headers, signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, status: res.status, data: null };
    return { ok: true, status: res.status, data: await res.arrayBuffer() };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: errText(e) };
  }
}

function b64ToBuf(b64: string): ArrayBuffer {
  const clean = b64.replace(/[\s\r\n]/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/**
 * 拼接采集接口的查询参数。
 * 绝大多数源用 ?ac=videolist&wd=xxx；部分源接口自带 query，需要正确追加。
 */
export function buildApiUrl(api: string, params: Record<string, string>): string {
  const sep = api.includes('?') ? '&' : '?';
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${api}${sep}${qs}`;
}
