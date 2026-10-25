/**
 * HLS 播放器。
 *
 * 采集源的播放地址几乎都是 m3u8（HLS）。Android WebView 原生不支持 HLS，
 * 所以统一交给 hls.js 解析：它同时处理 master playlist（多码率自动切换）
 * 和 media playlist，并且失败会自动重试分片。
 *
 * 原生平台上的媒体请求同样走 CapacitorHttp 配置的原生通道，
 * 不受 Referer / CORS 限制——实测部分源必须带 Referer 才返回 200。
 */
import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import { NativeHttpLoader, exitFullscreen, isFullscreen, onBack, setLandscape } from '../core';

interface Props {
  src: string;
  /** 起播位置（秒），用于续播 */
  startAt?: number;
  autoPlay?: boolean;
  onProgress?: (position: number, duration: number) => void;
  onError?: (message: string) => void;
  onEnded?: () => void;
}

type State = 'loading' | 'playing' | 'error';

/** 取播放地址的站点根，作为 Referer —— 多数资源站校验 Referer 防盗链 */
function refererOf(url: string): string {
  try {
    return `${new URL(url).origin}/`;
  } catch {
    return '';
  }
}

export default function Player({ src, startAt = 0, autoPlay = true, onProgress, onError, onEnded }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<State>('loading');
  const [message, setMessage] = useState('');
  const cbRef = useRef({ onProgress, onError, onEnded });
  cbRef.current = { onProgress, onError, onEnded };

  /*
   * 全屏与横屏联动。
   *
   * 视频全屏后画面是宽幅的，竖屏下左右大片留黑、上下空间浪费，
   * 必须自动转横屏才符合看视频的习惯。
   *
   * 判定方式刻意做成「事件 + 轮询」双保险，因为全屏事件在安卓上并不可靠：
   * 标准 Fullscreen API 会派发 fullscreenchange，但安卓 WebView 里用户点原生
   * 控件的全屏按钮走的是原生自定义 View（Capacitor 的
   * BridgeWebChromeClient.onShowCustomView），而 webkitbeginfullscreen /
   * webkitendfullscreen 本是 iOS Safari 的事件，安卓上并不保证派发。
   * 只靠事件会出现「有时转横屏、有时不转」的随机现象。
   *
   * 所以以轮询 webkitDisplayingFullscreen 为准（读取属性开销极小），
   * 事件监听作为快速路径，两者都收敛到同一个 sync()。
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // 记住上次同步过的状态，避免每 400ms 重复调用原生锁屏
    let last = isFullscreen();
    const sync = () => {
      const now = isFullscreen();
      if (now === last) return;
      last = now;
      void setLandscape(now);
    };

    const events = [
      'fullscreenchange',
      'webkitfullscreenchange',
      'webkitbeginfullscreen',
      'webkitendfullscreen',
    ];
    // 断言成 EventTarget：webkit 私有事件名不在标准事件表里，直接传会被类型系统挡下
    const doc = document as EventTarget;
    const vid = video as EventTarget;
    for (const e of events) {
      doc.addEventListener(e, sync);
      vid.addEventListener(e, sync);
    }
    const timer = window.setInterval(sync, 400);

    // 按返回键时若正在全屏，先退出全屏而不是直接离开播放页
    const offBack = onBack(() => {
      if (!isFullscreen()) return false;
      exitFullscreen();
      return true;
    });

    return () => {
      window.clearInterval(timer);
      for (const e of events) {
        doc.removeEventListener(e, sync);
        vid.removeEventListener(e, sync);
      }
      offBack();
      // 离开播放页必须转回竖屏：本 App 其余页面都是竖屏布局，
      // 带着横屏返回会让列表页与选集区错位
      void setLandscape(false);
    };
  }, []);

  /*
   * startAt 只能以 ref 读取，绝不能放进下面那个 effect 的依赖里。
   *
   * 原因是它会随着播放不断变大：播放 → 上报进度 → 上层写入历史 → history 变化
   * → 上层重新算出新的 startAt（5.1 → 5.2 → …）→ 依赖变化 → effect 重跑
   * → hls.destroy() 并重建播放器 → 位置归零 → 又从头播 → 再次上报……
   *
   * 表现出来就是「刚出画面就回到缓冲，并且总是重新开头」，永远播不过几秒。
   * 续播位置只在加载新地址时需要读一次，所以用 ref 传递最新值即可。
   */
  const startAtRef = useRef(startAt);
  startAtRef.current = startAt;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setState('loading');
    setMessage('');

    // 非 HLS（少数源给 mp4/flv 直链）直接交给原生 video 元素
    const isHls = /\.m3u8(\?|#|$)/i.test(src);

    let hls: Hls | null = null;
    // 致命错误只自愈一次：无限重试会让界面永远停在「正在缓冲」，无法触发换源
    let networkRetried = 0;
    let mediaRetried = 0;
    /** manifest 是否已成功解析，作为超时兜底的判据 */
    let started = false;
    let watchdog = 0;

    const applyStart = () => {
      const at = startAtRef.current;
      if (at > 1 && Number.isFinite(video.duration) && at < video.duration - 5) {
        video.currentTime = at;
      }
    };

    const fail = (msg: string) => {
      window.clearTimeout(watchdog);
      setState('error');
      setMessage(msg);
      cbRef.current.onError?.(msg);
    };

    if (isHls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        /*
         * 必须用自定义的 NativeHttpLoader，不能用 hls.js 自带的 FetchLoader。
         *
         * 启用 CapacitorHttp 后 window.fetch 被打补丁，跨域请求会改写成
         * https://localhost/_capacitor_http_interceptor_?u=<原始地址>，再由
         * WebView 拦截交给原生 OkHttp。由于拦截发生在原生层，响应无法告知
         * WebView 真正的来源，response.url 恒等于那个 localhost 代理地址。
         *
         * 而资源站的 master playlist 写的是相对路径（如 /play/hls/x/index.m3u8），
         * hls.js 以 response.url 为基准解析，结果会指向 localhost 的本地文件
         * 服务器，永远取不到数据 —— 表现为搜索正常、播放一直缓冲。
         *
         * NativeHttpLoader 直接走 CapacitorHttp 插件（与搜索同一条原生通道），
         * 并把 url 固定为真实地址，相对路径才能正确解析。详见 core/hlsLoader.ts。
         */
        loader: NativeHttpLoader,
        // 分片失败自动重试，源站偶发抖动不至于直接中断播放
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 600,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 800,
        maxBufferLength: 30,
        backBufferLength: 30,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        started = true;
        window.clearTimeout(watchdog);
        applyStart();
        if (autoPlay) void video.play().catch(() => undefined);
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        /*
         * 致命错误只自愈一次：无限重试会让界面永远停在「正在缓冲」，
         * 必须把错误上报给上层，才能触发自动换源。
         */
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetried < 1) {
          networkRetried += 1;
          hls?.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetried < 1) {
          mediaRetried += 1;
          hls?.recoverMediaError();
          return;
        }
        fail('该线路无法播放，请切换其他来源');
      });
      // 兜底：manifest 迟迟解析不出来也要给出反馈，不能一直转圈
      watchdog = window.setTimeout(() => {
        if (!started) fail('该线路响应超时，请切换其他来源');
      }, 20000);
    } else if (video.canPlayType('application/vnd.apple.mpegurl') && isHls) {
      // iOS Safari 原生支持 HLS
      video.src = src;
      const onLoaded = () => {
        applyStart();
        if (autoPlay) void video.play().catch(() => undefined);
      };
      video.addEventListener('loadedmetadata', onLoaded);
      hls = null;
      return () => video.removeEventListener('loadedmetadata', onLoaded);
    } else {
      video.src = src;
      if (autoPlay) void video.play().catch(() => undefined);
    }

    return () => {
      window.clearTimeout(watchdog);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
    /*
     * 依赖里刻意不含 startAt：它随播放进度不断变大，一旦进入依赖就会导致
     * 播放器被反复销毁重建（症状是刚出画面就回缓冲、并且总是重新开头）。
     * 续播位置通过 startAtRef 读取，见上方注释。
     */
  }, [src, autoPlay]);

  // 进度上报，用于续播与历史记录
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    /*
     * 位置一律取自这里缓存的值，而不是直接读 video.currentTime。
     *
     * 原因是卸载时的时序：上面那个 effect 的清理会执行 video.load()，
     * 把 currentTime 归零；若此时再去读实时值，就会把 0 写进观看历史，
     * 续播位置随之丢失。而 timeupdate 大约每 250ms 触发一次，页面切到
     * 后台时它会停住，缓存里留下的正好是切走前的位置，正是续播要用的值。
     */
    let pos = 0;
    let dur = 0;
    const track = () => {
      pos = video.currentTime;
      dur = video.duration;
    };
    const report = () => {
      if (Number.isFinite(dur) && dur > 0) cbRef.current.onProgress?.(pos, dur);
    };
    /*
     * last 以「当前时刻」为起点，而不是 0。若写成 0，首次 timeupdate 就会满足
     * now - 0 >= 5000 而立刻上报一次，等于刚起播就写了一条 position≈0 的
     * 历史记录，把上一次的续播位置覆盖掉。
     */
    let last = Date.now();
    const onTime = () => {
      track();
      const now = Date.now();
      if (now - last < 5000) return;
      last = now;
      report();
    };
    const onCanPlay = () => setState('playing');
    const onWaiting = () => setState('loading');
    const onPlaying = () => setState('playing');
    const onEnd = () => cbRef.current.onEnded?.();

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('ended', onEnd);
    // 页面隐藏前落一次进度，避免退出丢进度（此时播放器仍在，可读实时值）
    const onHide = () => {
      track();
      report();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);

    return () => {
      // 只上报缓存位置：此刻 video 可能已被 load() 归零，读实时值会写成 0
      report();
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('ended', onEnd);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  return (
    <>
      <video
        ref={videoRef}
        controls
        playsInline
        // 允许内联播放，安卓不会跳转全屏播放器
        webkit-playsinline="true"
        preload="metadata"
        poster=""
      />
      {state !== 'playing' && (
        <div className="player-overlay">
          {state === 'loading' ? (
            <>
              <div className="spinner" />
              <div>正在缓冲…</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 15, color: '#e8ecf4' }}>播放失败</div>
              <div>{message || '该线路暂时不可用'}</div>
              <div style={{ fontSize: 12.5, opacity: 0.75 }}>
                {refererOf(src) && `来源：${refererOf(src)}`}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
