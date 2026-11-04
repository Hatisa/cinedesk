import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PosterImage from '../components/PosterImage';
import { useApp } from '../state/AppState';
import { useToast } from '../components/Toast';
import { fetchById, formatWatchTime, latestWatchProgress, watchProgress, type FavoriteEntry, type HistoryEntry } from '../core';

type SavedEntry = FavoriteEntry | HistoryEntry;
const keyOf = (entry: Pick<SavedEntry, 'key' | 'sourceKey' | 'vodId'>) => `${entry.key}:${entry.sourceKey}:${entry.vodId}`;

export default function Favorites() {
  const nav = useNavigate();
  const { ready, sources, health, settings, favorites, history, toggleFav, removeHistory, clearHistory, restoreHistory, restoreFavorites } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState<'fav' | 'history'>('fav');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [updates, setUpdates] = useState<Record<string, string>>({});
  const updateCount = Object.keys(updates).length;

  // 回源核对最近 5 个收藏的更新备注。后台静默进行，失败不打扰用户。
  useEffect(() => {
    if (!ready || !favorites.length) { setUpdates({}); return; }
    const ctl = new AbortController();
    let alive = true;
    void Promise.all(favorites.slice(0, 5).map(async (fav) => {
      const source = sources.find((s) => s.key === fav.sourceKey && s.enabled);
      if (!source) return null;
      const fresh = await fetchById(source, fav.vodId, { health, timeoutMs: settings.timeoutMs, signal: ctl.signal });
      const variant = fresh?.variants.find((v) => v.sourceKey === fav.sourceKey && v.vodId === fav.vodId);
      const remarks = variant?.remarks.trim() ?? '';
      if (remarks && remarks !== fav.remarks.trim()) return [keyOf(fav), remarks] as const;
      return null;
    })).then((results) => {
      if (alive) setUpdates(Object.fromEntries(results.filter((r): r is readonly [string, string] => r !== null)));
    }).catch(() => undefined);
    return () => { alive = false; ctl.abort(); };
  }, [ready, favorites, sources, health, settings.timeoutMs]);

  const entries: SavedEntry[] = tab === 'fav' ? favorites : history;
  const allSelected = entries.length > 0 && selected.size === entries.length;
  const switchTab = (next: 'fav' | 'history') => { setTab(next); exitSelect(); };
  const exitSelect = () => { setSelecting(false); setSelected(new Set()); };
  const toggleSelect = (key: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const startSelect = (key?: string) => { setSelecting(true); setSelected(key ? new Set([key]) : new Set()); };
  const batchRemove = () => {
    if (!selected.size) return;
    if (tab === 'fav') {
      const removed = favorites.filter((f) => selected.has(keyOf(f)));
      removed.forEach((f) => toggleFav(f));
      toast(`已移除 ${removed.length} 个收藏`, { label: '撤销', onClick: () => restoreFavorites(removed) });
    } else {
      const removed = history.filter((h) => selected.has(keyOf(h)));
      removed.forEach((h) => removeHistory(h));
      toast(`已删除 ${removed.length} 条观看记录`, { label: '撤销', onClick: () => restoreHistory(removed) });
    }
    exitSelect();
  };
  const toDetail = (entry: SavedEntry) => nav(`/detail/${encodeURIComponent(entry.key)}?name=${encodeURIComponent(entry.name)}`, {
    state: { meta: { sourceKey: entry.sourceKey, vodId: entry.vodId } },
  });
  const thumb = (entry: SavedEntry) => entry.pic
    ? <PosterImage name={entry.name} urls={[entry.pic]} className="list-thumb" eager />
    : <div className="list-thumb poster-fallback">{entry.name.slice(0, 2)}</div>;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">我的</h1>{updateCount > 0 && <div className="page-sub update-note">{updateCount} 部收藏有更新</div>}</div>
        {entries.length > 0 && <button className="row-action" onClick={() => selecting ? exitSelect() : startSelect()}>{selecting ? '完成' : '批量管理'}</button>}
      </div>

      <div className="line-tabs" style={{ marginBottom: 14 }}>
        <button className={`line-tab${tab === 'fav' ? ' active' : ''}`} onClick={() => switchTab('fav')}>
          收藏 {favorites.length ? `(${favorites.length})` : ''}{updateCount > 0 && <span className="update-dot" aria-label="有更新" />}
        </button>
        <button className={`line-tab${tab === 'history' ? ' active' : ''}`} onClick={() => switchTab('history')}>
          观看记录 {history.length ? `(${history.length})` : ''}
        </button>
      </div>

      {selecting && (
        <div className="selection-bar">
          <button className="row-action" onClick={() => setSelected(allSelected ? new Set() : new Set(entries.map(keyOf)))}>{allSelected ? '取消全选' : '全选'}</button>
          <span>已选 {selected.size} 项</span>
          <button className="row-action danger-action" disabled={!selected.size} onClick={batchRemove}>删除</button>
        </div>
      )}

      {tab === 'fav' && (favorites.length === 0 ? (
        <div className="empty"><div className="empty-icon">⭐</div><div>还没有收藏</div><div className="hint">在影片详情页点「收藏」，方便下次直接找到</div></div>
      ) : (
        <div className="list saved-list">{favorites.map((f) => {
          const key = keyOf(f);
          return <div className={`list-row${selected.has(key) ? ' selected' : ''}`} key={key}
            onContextMenu={(e) => { e.preventDefault(); startSelect(key); }}>
            {selecting && <input className="select-check" type="checkbox" checked={selected.has(key)} onChange={() => toggleSelect(key)} aria-label={`选择 ${f.name}`} />}
            {thumb(f)}
            <button className="list-body list-body-button" onClick={() => selecting ? toggleSelect(key) : toDetail(f)}>
              <div className="list-title">{f.name}</div>
              <div className="list-desc">{[f.year, f.remarks].filter(Boolean).join(' · ') || f.sourceName}</div>
              {(() => {
                const watched = latestWatchProgress(history, f);
                if (!watched) return null;
                const progress = watchProgress(watched);
                return <>
                  <div className="list-progress-text">{watched.episodeName || `第${watched.episodeIndex + 1}集`} · {progress.position > 0 ? `已看 ${progress.positionLabel}` : '尚未播放'}{progress.percent !== null ? ` · ${progress.percent}%` : ''}</div>
                  {progress.duration > 0 && <div className="list-progress-meta">共 {progress.durationLabel} · 剩余 {formatWatchTime(Math.max(0, progress.duration - progress.position))}</div>}
                  {progress.percent !== null && <div className="list-progress" role="progressbar" aria-label={`${f.name}观看进度`} aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}><div className="list-progress-fill" style={{ width: `${progress.percent}%` }} /></div>}
                </>;
              })()}
              {updates[key] && <div className="update-badge">有更新 · {updates[key]}</div>}
            </button>
            {!selecting && <button className="row-action" onClick={() => { toggleFav(f); toast(`已移除「${f.name}」`, { label: '撤销', onClick: () => restoreFavorites([f]) }); }}>移除</button>}
          </div>;
        })}</div>
      ))}

      {tab === 'history' && (history.length === 0 ? (
        <div className="empty"><div className="empty-icon">🕘</div><div>还没有观看记录</div><div className="hint">看过的影片会自动记录进度，下次接着看</div></div>
      ) : (
        <>
          {!selecting && <div className="section-head"><span className="section-title">最近观看</span><button className="section-more" onClick={() => { const removed = [...history]; clearHistory(); toast('观看记录已清空', { label: '撤销', onClick: () => restoreHistory(removed) }); }}>清空</button></div>}
          <div className="list saved-list">{history.map((h) => {
            const key = keyOf(h);
            const progress = watchProgress(h);
            return <div className={`list-row${selected.has(key) ? ' selected' : ''}`} key={key}>
              {selecting && <input className="select-check" type="checkbox" checked={selected.has(key)} onChange={() => toggleSelect(key)} aria-label={`选择 ${h.name}`} />}
              {thumb(h)}
              <button className="list-body list-body-button" onClick={() => selecting ? toggleSelect(key) : toDetail(h)}>
                <div className="list-title">{h.name}</div>
                <div className="list-desc">{h.episodeName || `第${h.episodeIndex + 1}集`} · {h.sourceName}</div>
                <div className="list-progress-text">{progress.position > 0 ? `已看 ${progress.positionLabel}` : '尚未播放'}{progress.percent !== null ? ` · ${progress.percent}%` : ''}</div>
                {progress.duration > 0 && <div className="list-progress-meta">共 {progress.durationLabel} · 剩余 {formatWatchTime(Math.max(0, progress.duration - progress.position))}</div>}
                {progress.percent !== null && <div className="list-progress" role="progressbar" aria-label={`${h.name}观看进度`} aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}><div className="list-progress-fill" style={{ width: `${progress.percent}%` }} /></div>}
              </button>
              {!selecting && <button className="row-action" onClick={() => { removeHistory(h); toast(`已删除「${h.name}」的观看记录`, { label: '撤销', onClick: () => restoreHistory([h]) }); }}>删除</button>}
            </div>;
          })}</div>
        </>
      ))}
    </div>
  );
}
