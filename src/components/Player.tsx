import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import { NativeHttpLoader, exitFullscreen, isFullscreen, onBack, setLandscape } from '../core';
import { resumePosition } from '../core/media';

interface Props {
  src: string;
  startAt?: number;
  autoPlay?: boolean;
  retryKey?: number;
  onProgress?: (position: number, duration: number) => void;
  onError?: (message: string) => void;
  onRetry?: () => void;
  onEnded?: () => void;
  onPlaying?: () => void;
}
type State = 'loading' | 'playing' | 'error';

/** HLS 与直链视频共用一个 video，但每个地址独立管理资源、监听器和进度。 */
export default function Player({ src, startAt = 0, autoPlay = true, retryKey = 0, onProgress, onError, onRetry, onEnded, onPlaying }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<State>('loading');
  const [message, setMessage] = useState('');
  const cbRef = useRef({ onProgress, onError, onEnded, onPlaying });
  cbRef.current = { onProgress, onError, onEnded, onPlaying };
  const startAtRef = useRef(startAt);
  startAtRef.current = startAt;

  // 全屏与横屏联动。标准事件与 WebView 私有属性都检查，离开页面恢复竖屏。
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let last = isFullscreen();
    const sync = () => {
      const now = isFullscreen();
      if (now === last) return;
      last = now;
      void setLandscape(now);
    };
    const events = ['fullscreenchange', 'webkitfullscreenchange', 'webkitbeginfullscreen', 'webkitendfullscreen'];
    const doc = document as EventTarget;
    const vid = video as EventTarget;
    for (const event of events) {
      doc.addEventListener(event, sync);
      vid.addEventListener(event, sync);
    }
    const timer = window.setInterval(sync, 400);
    const offBack = onBack(() => {
      if (!isFullscreen()) return false;
      exitFullscreen();
      return true;
    });
    return () => {
      window.clearInterval(timer);
      for (const event of events) {
        doc.removeEventListener(event, sync);
        vid.removeEventListener(event, sync);
      }
      offBack();
      void setLandscape(false);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    let disposed = false;
    let failed = false;
    let announced = false;
    let watchdog = 0;
    let networkRetried = false;
    let mediaRetried = false;
    let hls: Hls | null = null;
    const isHls = /\.m3u8(\?|#|$)/i.test(src);
    setState('loading');
    setMessage('');

    const clearWatchdog = () => window.clearTimeout(watchdog);
    const armWatchdog = () => {
      clearWatchdog();
      watchdog = window.setTimeout(() => fail('播放响应超时，可重试或切换线路'), 20000);
    };
    const fail = (text: string) => {
      if (disposed || failed) return;
      failed = true;
      clearWatchdog();
      setState('error');
      setMessage(text);
      cbRef.current.onError?.(text);
    };
    const announcePlaying = () => {
      clearWatchdog();
      setState('playing');
      if (!announced) {
        announced = true;
        cbRef.current.onPlaying?.();
      }
    };
    const play = () => {
      if (disposed) return;
      void video.play().catch((error: unknown) => {
        if (disposed || (error instanceof Error && error.name === 'AbortError')) return;
        // 自动播放权限不是线路故障，不触发无意义的自动换源。
        setState('error');
        setMessage('请点击下方重试开始播放');
      });
    };
    const onLoaded = () => {
      if (disposed) return;
      video.currentTime = resumePosition(startAtRef.current, video.duration);
      armWatchdog();
      play();
    };
    const onWaiting = () => {
      if (!announced || failed) return;
      setState('loading');
      armWatchdog();
    };
    const onMediaError = () => {
      if (disposed) return;
      const codes: Record<number, string> = {
        1: '播放已中止', 2: '网络异常，无法读取视频', 3: '视频解码失败', 4: '视频地址无效或格式不受支持',
      };
      fail(codes[video.error?.code ?? 0] || '该视频暂时无法播放');
    };
    video.addEventListener('playing', announcePlaying);
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('error', onMediaError);
    armWatchdog();

    if (isHls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        // Capacitor 下保留真实响应 URL，才能正确解析相对分片路径。
        loader: NativeHttpLoader,
        manifestLoadingMaxRetry: 2,
        manifestLoadingRetryDelay: 600,
        levelLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 3,
        fragLoadingRetryDelay: 800,
        maxBufferLength: 30,
        backBufferLength: 30,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || disposed) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !networkRetried) {
          networkRetried = true;
          hls?.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRetried) {
          mediaRetried = true;
          hls?.recoverMediaError();
          return;
        }
        fail('该线路无法播放，可重试或切换来源');
      });
    } else {
      // MP4、原生 HLS 都走 loadedmetadata/error/watchdog，不再绕过续播与错误处理。
      video.src = src;
      video.load();
    }
    return () => {
      disposed = true;
      clearWatchdog();
      hls?.destroy();
      video.removeEventListener('playing', announcePlaying);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('error', onMediaError);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [src, autoPlay, retryKey]);

  // 以 src 为周期捕获回调：卸载时旧地址的进度只能写回旧集，不能串到新集。
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let pos = 0;
    let dur = 0;
    let finished = false;
    const progressCb = cbRef.current.onProgress;
    const track = () => {
      pos = video.currentTime;
      dur = video.duration;
    };
    const report = () => {
      if (!finished && Number.isFinite(dur) && dur > 0) progressCb?.(pos, dur);
    };
    const onEnd = () => {
      track();
      finished = true;
      if (Number.isFinite(dur) && dur > 0) progressCb?.(pos, dur);
      cbRef.current.onEnded?.();
    };
    const onHide = () => {
      if (document.visibilityState !== 'visible') {
        track();
        report();
      }
    };
    video.addEventListener('timeupdate', track);
    video.addEventListener('loadedmetadata', track);
    video.addEventListener('pause', track);
    video.addEventListener('ended', onEnd);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      // load() 已可能清空 currentTime，所以上报本周期缓存值。
      report();
      video.removeEventListener('timeupdate', track);
      video.removeEventListener('loadedmetadata', track);
      video.removeEventListener('pause', track);
      video.removeEventListener('ended', onEnd);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [src, retryKey]);

  return (
    <>
      <video ref={videoRef} controls playsInline webkit-playsinline="true" preload="metadata" poster="" />
      {state !== 'playing' && (
        <div className="player-overlay" role={state === 'error' ? 'alert' : 'status'}>
          {state === 'loading' ? (
            <><div className="spinner" /><div>正在缓冲…</div></>
          ) : (
            <>
              <div style={{ fontSize: 15, color: '#e8ecf4' }}>播放失败</div>
              <div>{message || '该线路暂时不可用'}</div>
              <button className="btn primary player-retry" onClick={() => {
                setState('loading');
                setMessage('');
                onRetry?.();
              }}>重试</button>
            </>
          )}
        </div>
      )}
    </>
  );
}
