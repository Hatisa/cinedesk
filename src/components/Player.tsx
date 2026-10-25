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
import { NativeHttpLoader } from '../core';

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
      if (startAt > 1 && Number.isFinite(video.duration) && startAt < video.duration - 5) {
        video.currentTime = startAt;
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
  }, [src, startAt, autoPlay]);

  // 进度上报，用于续播与历史记录
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let last = 0;
    const onTime = () => {
      const now = Date.now();
      if (now - last < 5000) return;
      last = now;
      if (Number.isFinite(video.duration)) cbRef.current.onProgress?.(video.currentTime, video.duration);
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
    // 页面隐藏前落一次进度，避免退出丢进度
    const onHide = () => {
      if (Number.isFinite(video.duration)) {
        cbRef.current.onProgress?.(video.currentTime, video.duration);
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);

    return () => {
      onHide();
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
