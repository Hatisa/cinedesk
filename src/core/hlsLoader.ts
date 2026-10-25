/**
 * 为 hls.js 定制的加载器：所有媒体请求都走 CapacitorHttp 原生通道。
 *
 * ## 为什么不能直接用 hls.js 自带的 FetchLoader
 *
 * 启用 CapacitorHttp 后，Capacitor 会给 window.fetch 打补丁：跨域请求被改写成
 *
 *   https://localhost/_capacitor_http_interceptor_?u=<原始地址>
 *
 * 再由 WebView 的 shouldInterceptRequest 交给原生 OkHttp 拉取后返回。
 *
 * 问题在于：拦截发生在原生层，WebView 只知道「我请求的是 localhost 上这个代理地址」，
 * 无法得知响应真正来自哪个站点，于是 response.url 恒等于那个代理地址。
 *
 * 而 hls.js 恰恰用 response.url 作为解析 m3u8 内相对地址的基准
 * （getResponseUrl → new URL(uri, baseUrl)）。绝大多数资源站的 master playlist
 * 写的是相对路径，例如：
 *
 *   #EXT-X-STREAM-INF:BANDWIDTH=4096000,RESOLUTION=1920x1080
 *   /play/hls/xxx/index.m3u8
 *
 * 一旦基准变成 localhost，解析结果就成了 https://localhost/play/hls/xxx/index.m3u8，
 * 请求打到 WebView 的本地文件服务器上，永远取不到数据，只能反复重试。
 * 表现出来的症状是：搜索一切正常，点播放后一直停在「正在缓冲」。
 *
 * ## 这里怎么做
 *
 * 直接用 CapacitorHttp 插件——也就是搜索功能正在用、已被验证可用的那条原生通道
 * ——拉取数据，并把 LoaderResponse.url 固定为 context.url，让相对地址始终以
 * 真实地址为基准解析。原生侧对二进制响应返回的是 base64，这里解码回 ArrayBuffer。
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import {
  BaseLoader,
  type LoaderCallbacks,
  type LoaderConfiguration,
  type LoaderContext,
  type NullableNetworkDetails,
} from 'hls.js';

const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/** 取站点根作为 Referer —— 部分资源站校验防盗链 */
function refererOf(url: string): string {
  try {
    return `${new URL(url).origin}/`;
  } catch {
    return '';
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

function toText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data == null) return '';
  return JSON.stringify(data);
}

/**
 * 原生侧 responseType='arraybuffer' 返回的是 base64 字符串，这里还原为 ArrayBuffer。
 * Java 用的是 Base64.DEFAULT（每 76 字符会插入换行），先清掉所有空白字符再解码。
 */
function toArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  if (typeof data === 'string') {
    const bin = atob(data.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  return new ArrayBuffer(0);
}

function normalizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[k] = typeof v === 'string' ? v : String(v);
    }
  }
  return out;
}

interface RawResponse {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

export class NativeHttpLoader extends BaseLoader {
  /** 已中止的加载器会丢弃迟到的响应 */
  private cancelled = false;
  private resHeaders: Record<string, string> = {};

  protected loadInternal(): void {
    const { context, config, callbacks, stats } = this;
    if (!context || !config || !callbacks || !stats) return;

    this.cancelled = false;
    this.resHeaders = {};
    stats.aborted = false;
    stats.loaded = 0;
    stats.loading.start = performance.now();
    stats.loading.first = 0;
    stats.loading.end = 0;

    const isBinary = context.responseType === 'arraybuffer';
    const timeout = config.loadPolicy.maxLoadTimeMs > 0 ? config.loadPolicy.maxLoadTimeMs : 20000;

    /*
     * 必须自己调度超时。CapacitorHttp 有 connect/read timeout 会 reject，
     * 但浏览器路径的 fetch 可能一直挂着；没有这层兜底就又会表现为「一直缓冲」。
     */
    window.clearTimeout(this.requestTimeout);
    this.requestTimeout = window.setTimeout(() => this.loadtimeout(), timeout);

    void this.fetchOnce(context, isBinary, timeout)
      .then((res) => {
        window.clearTimeout(this.requestTimeout);
        if (this.cancelled) return;
        this.resHeaders = res.headers;

        if (res.status < 200 || res.status >= 300) {
          this.handleFailure(context, config, callbacks, res.status, `HTTP ${res.status}`);
          return;
        }

        const data: string | ArrayBuffer = isBinary ? toArrayBuffer(res.data) : toText(res.data);
        const size = typeof data === 'string' ? data.length : data.byteLength;
        const now = performance.now();
        if (!stats.loading.first) stats.loading.first = now;
        stats.loading.end = now;
        stats.loaded = size;
        stats.total = size;

        callbacks.onSuccess({ url: context.url, data, code: res.status }, stats, context, null);
      })
      .catch((err) => {
        window.clearTimeout(this.requestTimeout);
        if (this.cancelled) return;
        this.handleFailure(context, config, callbacks, 0, errText(err));
      });
  }

  /** 按 hls.js 下发的重试策略决定重试还是上报失败 */
  private handleFailure(
    context: LoaderContext,
    config: LoaderConfiguration,
    callbacks: LoaderCallbacks<LoaderContext>,
    code: number,
    text: string,
  ): void {
    const stats = this.stats;
    if (!stats) return;
    const retryConfig = config.loadPolicy.errorRetry;
    if (retryConfig && stats.retry < retryConfig.maxNumRetry) {
      this.retry(retryConfig);
      return;
    }
    callbacks.onError({ code, text }, context, null, stats);
  }

  /** 原生平台走 OkHttp（同时绕开 CORS 与 Referer 校验）；浏览器开发时直连 */
  private async fetchOnce(
    context: LoaderContext,
    isBinary: boolean,
    timeout: number,
  ): Promise<RawResponse> {
    const headers: Record<string, string> = {
      'User-Agent': UA,
      ...(context.headers ?? {}),
    };
    const referer = refererOf(context.url);
    if (referer && !headers.Referer && !headers.referer) headers.Referer = referer;
    /*
     * 必须与 hls.js 自身的判断保持一致：它用 rangeEnd 的**真假值**来决定是否
     * 发送 Range 头（见 hls.js getRequestParameters），并用 rangeEnd - 1 作为
     * 闭区间终点。hls.js 用 rangeStart=0/rangeEnd=0 表示「要整个分片」。
     *
     * 若写成 `rangeStart != null || rangeEnd != null`，0 会通过判断，于是发出
     * `Range: bytes=0-0`，服务器只回 1 字节 —— 分片解析必然失败，表现为一直缓冲。
     */
    if (context.rangeEnd) {
      headers.Range = `bytes=${context.rangeStart ?? 0}-${context.rangeEnd - 1}`;
    }

    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.request({
        url: context.url,
        method: 'GET',
        headers,
        responseType: isBinary ? 'arraybuffer' : 'text',
        connectTimeout: timeout,
        readTimeout: timeout,
      });
      return {
        status: res.status,
        data: res.data as unknown,
        headers: normalizeHeaders(res.headers),
      };
    }

    const res = await fetch(context.url, { headers });
    const data: unknown = isBinary ? await res.arrayBuffer() : await res.text();
    const hdrs: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      hdrs[k] = v;
    });
    return { status: res.status, data, headers: hdrs };
  }

  protected abortInternal(): void {
    this.cancelled = true;
  }

  protected resetInternalLoader(): void {
    this.resHeaders = {};
  }

  protected getNetworkDetails(): NullableNetworkDetails {
    return null;
  }

  getCacheAge(): number | null {
    return null;
  }

  getResponseHeader(name: string): string | null {
    const lower = name.toLowerCase();
    const key = Object.keys(this.resHeaders).find((k) => k.toLowerCase() === lower);
    return key ? this.resHeaders[key] : null;
  }
}
