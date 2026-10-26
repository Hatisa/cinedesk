/**
 * 缓存管理器：把「缓存这几集」变成一串可追踪、可取消的任务。
 *
 * 放在全局（而不是详情页内部）有两个原因：
 *   1) 用户点完缓存就会退出详情页去看别的，任务必须继续跑；
 *   2) 离线库页面要能显示正在下载的进度。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  allocShowDir,
  downloadEpisode,
  epDir,
  fmtBytes,
  fmtSpeed,
  startKeepAlive,
  stopKeepAlive,
  TaskQueue,
  updateKeepAlive,
  type QueueTask,
  type Quality,
} from '../core';
import { useApp } from './AppState';

/** 一集缓存任务所需的信息 */
export interface DownloadJob {
  /** 剧的聚合键 */
  key: string;
  name: string;
  pic: string;
  year: string;
  typeName: string;
  epIndex: number;
  epName: string;
  /** 该集的在线播放地址 */
  url: string;
  sourceKey: string;
  sourceName: string;
  lineName: string;
}

export type DownloadTask = QueueTask<DownloadJob>;

interface DownloadValue {
  tasks: DownloadTask[];
  /** 入队；同一集重复入队会被忽略 */
  enqueue: (jobs: DownloadJob[]) => void;
  cancel: (id: string) => void;
  /** 重试还是走 enqueue（同一 id 结束后可重新入队） */
  retry: (id: string) => void;
  /** 清掉已结束的记录 */
  clearFinished: () => void;
  /** 该集是否在队列中（等待或进行中） */
  isQueued: (key: string, epIndex: number) => boolean;
  /** 该集是否已缓存完成 */
  isCached: (key: string, epIndex: number) => boolean;
  /** 取该集的任务（含进度），不在队列则返回 undefined */
  taskOf: (key: string, epIndex: number) => DownloadTask | undefined;
}

/** 任务 id：一部剧 + 一集，全局唯一 */
export const jobId = (key: string, epIndex: number): string => `${key}#${epIndex}`;

const Ctx = createContext<DownloadValue | null>(null);

export function DownloadProvider({ children }: { children: ReactNode }) {
  const { offline, settings, saveOfflineEpisode } = useApp();
  const [tasks, setTasks] = useState<DownloadTask[]>([]);

  /*
   * 队列实例只建一次。
   * 若跟着 tasks 变化重建，正在执行的任务会被丢掉——队列内部持有
   * 等待列表与 AbortController，是「活着」的状态，不能放进 React 的重渲染里。
   */
  const queueRef = useRef<TaskQueue<DownloadJob> | null>(null);

  /*
   * 下载是异步的，回调里读到的 offline 会是入队那一刻的旧值。
   * 用 ref 镜像最新的索引，allocShowDir 才能看到已存在的剧目录，
   * 否则同时缓存两部剧时可能算出同一个目录名。
   */
  const offlineRef = useRef(offline);
  offlineRef.current = offline;

  /** 缓存画质同样要在异步回调里读到最新值 */
  const qualityRef = useRef<Quality>(settings.cacheQuality);
  qualityRef.current = settings.cacheQuality;

  if (!queueRef.current) {
    queueRef.current = new TaskQueue<DownloadJob>({
      onChange: (list) => setTasks([...list]),
      run: async (job, progress, signal) => {
        const list = offlineRef.current;
        const found = list.find((s) => s.key === job.key);
        const showDir = found?.showDir ?? allocShowDir(list, job.name, job.key);
        const dir = `${showDir}/${epDir(job.epIndex, job.epName)}`;

        const res = await downloadEpisode(job.url, {
          dir,
          quality: qualityRef.current,
          onProgress: progress,
          signal,
        });

        /*
         * 分片全部落盘后才写索引。
         * 先写索引的话，中途失败会留下「自称已缓存、点开却播不了」的记录，
         * 而离线时用户没法重新缓存——只能卸了重装。
         */
        saveOfflineEpisode(
          {
            key: job.key,
            name: job.name,
            pic: job.pic,
            year: job.year,
            typeName: job.typeName,
            showDir,
          },
          {
            epIndex: job.epIndex,
            epName: job.epName,
            dir,
            segments: res.segments,
            bytes: res.bytes,
            duration: res.duration,
            quality: qualityRef.current,
            sourceKey: job.sourceKey,
            sourceName: job.sourceName,
            lineName: job.lineName,
            createdAt: Date.now(),
          },
        );
      },
    });
  }
  const queue = queueRef.current;

  const enqueue = useCallback(
    (jobs: DownloadJob[]) => {
      for (const job of jobs) queue.add(jobId(job.key, job.epIndex), job);
    },
    [queue],
  );

  const cancel = useCallback((id: string) => queue.cancel(id), [queue]);

  const retry = useCallback(
    (id: string) => {
      const t = queue.find(id);
      if (t) queue.add(id, t.payload);
    },
    [queue],
  );

  const clearFinished = useCallback(() => {
    for (const t of queue.snapshot()) {
      if (t.status !== 'waiting' && t.status !== 'running') queue.remove(t.id);
    }
  }, [queue]);

  const isQueued = useCallback(
    (key: string, epIndex: number) => queue.has(jobId(key, epIndex)),
    [queue],
  );

  const isCached = useCallback(
    (key: string, epIndex: number) =>
      !!offline.find((s) => s.key === key)?.episodes.some((e) => e.epIndex === epIndex),
    [offline],
  );

  const taskOf = useCallback(
    (key: string, epIndex: number) => tasks.find((t) => t.id === jobId(key, epIndex)),
    [tasks],
  );

  /*
   * 后台保活：有任务在跑就开前台服务。
   *
   * 熄屏后系统会冻结 WebView，下载循环随之停住 —— 用户锁屏十分钟回来
   * 看到的进度和走的时候一样。前台服务 + WAKE_LOCK 才能让「熄屏继续下载」
   * 成立（浏览器调试时这些调用是空操作）。
   */
  const hasActive = tasks.some((t) => t.status === 'waiting' || t.status === 'running');

  // 只在「从无到有 / 从有到无」时开关服务，不随进度反复重启（会造成通知闪烁）
  useEffect(() => {
    if (hasActive) void startKeepAlive('正在缓存，切到后台也会继续');
    else void stopKeepAlive();
  }, [hasActive]);

  /*
   * 进度文案：锁屏时用户靠这条通知看进展。
   * 带上百分比、已下体积与速度 —— 只有「正在缓存」四个字时，
   * 用户无法区分「在下」和「卡住了」，这正是之前的体验问题。
   */
  const running = tasks.find((t) => t.status === 'running');
  const progressText = running
    ? running.total > 0
      ? `第 ${running.payload.epIndex + 1} 集 ${Math.floor((running.done / running.total) * 100)}% · ${fmtBytes(
          running.bytes,
        )}${running.speed > 0 ? ` · ${fmtSpeed(running.speed)}` : ''}`
      : `第 ${running.payload.epIndex + 1} 集 解析分片中…`
    : '等待开始缓存';

  useEffect(() => {
    if (hasActive) void updateKeepAlive(progressText);
  }, [hasActive, progressText]);

  const value = useMemo<DownloadValue>(
    () => ({ tasks, enqueue, cancel, retry, clearFinished, isQueued, isCached, taskOf }),
    [tasks, enqueue, cancel, retry, clearFinished, isQueued, isCached, taskOf],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDownload(): DownloadValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDownload 必须在 DownloadProvider 内使用');
  return ctx;
}
