import type { HistoryEntry } from './types.ts';

export interface WatchProgress {
  position: number;
  duration: number;
  percent: number | null;
  positionLabel: string;
  durationLabel: string;
  summary: string;
}

/** 进度展示不依赖总时长：未知时仍展示已观看时间，避免历史只剩片名与集数。 */
export function watchProgress(entry: Pick<HistoryEntry, 'position' | 'duration'>): WatchProgress {
  const duration = Number.isFinite(entry.duration) && entry.duration > 0 ? entry.duration : 0;
  const rawPosition = Number.isFinite(entry.position) && entry.position > 0 ? entry.position : 0;
  const position = duration > 0 ? Math.min(rawPosition, duration) : rawPosition;
  const percent = duration > 0 ? Math.min(100, Math.floor((position / duration) * 100)) : null;
  const positionLabel = formatWatchTime(position);
  const durationLabel = formatWatchTime(duration);
  const summary = duration > 0
    ? `已看 ${positionLabel} / ${durationLabel} · ${percent}% · 剩余 ${formatWatchTime(Math.max(0, duration - position))}`
    : position > 0 ? `已观看 ${positionLabel}` : '尚未播放';
  return { position, duration, percent, positionLabel, durationLabel, summary };
}

export function formatWatchTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** 历史记录保留同作品最新的有效进度，避免元数据缺失时的零值覆盖已有进度。 */
export function latestWatchProgress(history: HistoryEntry[], work: Pick<HistoryEntry, 'key' | 'sourceKey' | 'vodId'>): HistoryEntry | undefined {
  return history.find((h) => h.key === work.key && h.sourceKey === work.sourceKey && h.vodId === work.vodId && (h.position > 0 || h.episodeIndex > 0));
}
