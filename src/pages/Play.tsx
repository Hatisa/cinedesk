import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Player from '../components/Player';
import { useToast } from '../components/Toast';
import {
  failureKey,
  fetchById,
  getItem,
  matchesSavedWork,
  moveSelection,
  nextPlayable,
  nonNegativeInt,
  playPath,
  putItems,
  searchAll,
  selectionFor,
  type AggregatedItem,
  type PlaySelection,
} from '../core';
import { useApp } from '../state/AppState';

export default function Play() {
  const { key = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const { ready, sources, health, settings, history, rememberPlay, persistHealth } = useApp();
  const passed = (loc.state as { item?: AggregatedItem } | null)?.item;
  const [item, setItem] = useState<AggregatedItem | null>(passed ?? getItem(key));
  const [showLines, setShowLines] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [retryKey, setRetryKey] = useState(0);
  const [resumeAt, setResumeAt] = useState<number | undefined>((loc.state as { resumeAt?: number } | null)?.resumeAt);
  const [selection, setSelection] = useState<PlaySelection>(() => item ? selectionFor(item, routeFrom(sp)) : { variantIdx: 0, lineIdx: 0, epIdx: nonNegativeInt(sp.get('ep')) });
  const failedRef = useRef(failed);
  const selectionRef = useRef(selection);
  failedRef.current = failed;
  selectionRef.current = selection;
  const name = sp.get('name') || item?.name || key.split('~')[0];

  // 冷启动：先按 source+vod 回源，再按片名搜索；没有条目时也提供返回出口。
  useEffect(() => {
    if (item || !ready) return;
    let alive = true;
    const ctl = new AbortController();
    const meta = (loc.state as { meta?: { sourceKey: string; vodId: string } } | null)?.meta;
    const sourceKey = meta?.sourceKey || sp.get('source') || '';
    const vodId = meta?.vodId || sp.get('vod') || '';
    const source = sources.find((s) => s.key === sourceKey);
    void (async () => {
      if (source && vodId) {
        const restored = await fetchById(source, vodId, { health, timeoutMs: settings.timeoutMs, signal: ctl.signal });
        if (!alive) return;
        if (restored && restored.key === key) {
          putItems([restored]);
          setItem(restored);
          return;
        }
      }
      if (!name) {
        if (alive) setNotFound(true);
        return;
      }
      const res = await searchAll(name, { sources, health, timeoutMs: settings.timeoutMs, signal: ctl.signal });
      if (!alive) return;
      putItems(res.items);
      persistHealth();
      const hit = res.items.find((i) => i.key === key || (vodId && matchesSavedWork(i, { key, name, year: sp.get('year') || '', sourceKey, vodId })));
      setItem(hit ?? null);
      setNotFound(!hit);
    })().catch(() => {
      if (alive) setNotFound(true);
    });
    return () => {
      alive = false;
      ctl.abort();
    };
  }, [item, ready, name, key, sources, health, settings.timeoutMs, persistHealth, loc.state, sp]);

  // 路由（含浏览器前进/后退）是当前播放状态的单一事实来源。
  useEffect(() => {
    if (!item) return;
    const next = selectionFor(item, routeFrom(sp));
    if (!sameSelection(next, selectionRef.current)) setSelection(next);
  }, [item, sp]);

  const current = item?.variants[selection.variantIdx] ?? null;
  const line = current?.lines[selection.lineIdx] ?? null;
  const epTotal = line?.episodes.length ?? 0;
  const episode = line?.episodes[selection.epIdx] ?? null;
  const hist = item && current ? history.find((h) =>
    h.sourceKey === current.sourceKey && h.vodId === current.vodId && matchesSavedWork(item, h),
  ) : undefined;

  const startAt = resumeAt !== undefined ? resumeAt : hist && hist.episodeIndex === selection.epIdx ? hist.position : 0;
  const activeEpRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeEpRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selection.epIdx, selection.variantIdx, selection.lineIdx]);

  const changeSelection = (next: PlaySelection, replace = true) => {
    if (!item || sameSelection(next, selectionRef.current)) return;
    const clamped = moveSelection(item, selectionRef.current, next);
    const path = playPath(item, clamped);
    // replace 保持播放器返回按钮可回到详情；浏览器前进/后退仍由真实路由同步。
    if (replace) setSp(new URLSearchParams(path.split('?')[1]), { replace: true });
    else nav(path, { state: { item } });
    setSelection(clamped);
    setResumeAt(undefined);
  };

  const onProgress = (position: number, duration: number) => {
    if (!item || !settings.recordHistory || !current || !episode) return;
    rememberPlay({
      key: item.key, name: item.name, pic: item.pic,
      sourceKey: current.sourceKey, sourceName: current.sourceName, vodId: current.vodId,
      episodeIndex: selection.epIdx, episodeName: episode.name, position, duration, updatedAt: Date.now(),
    });
  };

  const onError = () => {
    if (!item) return;
    const currentFailure = current ? failureKey(current, selection.lineIdx) : '';
    const nextFailed = new Set(failedRef.current);
    if (currentFailure) nextFailed.add(currentFailure);
    setFailed(nextFailed);
    const next = nextPlayable(item, selection, nextFailed);
    if (!next) return;
    toast('线路不可用，已自动切换并保留当前集数');
    changeSelection(next);
  };

  const onEnded = () => {
    const nextIdx = selection.epIdx + 1;
    if (!line || nextIdx >= epTotal) return;
    const nextEp = line.episodes[nextIdx];
    if (item && current && settings.recordHistory && nextEp) {
      rememberPlay({
        key: item.key, name: item.name, pic: item.pic,
        sourceKey: current.sourceKey, sourceName: current.sourceName, vodId: current.vodId,
        episodeIndex: nextIdx, episodeName: nextEp.name, position: 0, duration: 0, updatedAt: Date.now(),
      });
    }
    changeSelection({ ...selection, epIdx: nextIdx });
  };

  if (!item) {
    return (
      <div className="player-page">
        <PlayerBar title={name || '播放'} onBack={() => nav(-1)} />
        <div className="empty" style={{ margin: 'auto' }}>
          {notFound ? (
            <>
              <div className="empty-icon">📭</div>
              <div>未找到「{name || '该影片'}」</div>
              <div className="hint">地址可能已失效，请重新搜索，或检查网络与资源源设置。</div>
              <button className="btn primary" style={{ maxWidth: 220 }} onClick={() => nav(`/?q=${encodeURIComponent(name)}`)}>返回搜索</button>
            </>
          ) : (
            <>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              <div>正在获取播放地址…</div>
              <button className="btn" style={{ maxWidth: 180, margin: '12px auto 0' }} onClick={() => nav(-1)}>取消并返回</button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!episode) {
    return (
      <div className="player-page">
        <PlayerBar title={item.name} onBack={() => nav(-1)} />
        <div className="empty" style={{ margin: 'auto' }}>
          <div className="empty-icon">🎞️</div><div>该来源没有可直接播放的地址</div>
          <button className="btn primary" style={{ maxWidth: 220 }} onClick={() => nav(`/detail/${encodeURIComponent(item.key)}?name=${encodeURIComponent(item.name)}`, { state: { item } })}>返回详情切换来源</button>
        </div>
      </div>
    );
  }

  return (
    <div className="player-page">
      <div className="player-bar">
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="返回"><BackIcon /></button>
        <div className="player-title">{item.name} · {episode.name}</div>
        <button className="icon-btn" onClick={() => setShowLines((v) => !v)} aria-label="切换来源" aria-expanded={showLines}><SwitchIcon /></button>
      </div>
      <div className="player-stage">
        <Player src={episode.url} startAt={startAt} autoPlay retryKey={retryKey}
          onProgress={onProgress} onError={onError} onEnded={onEnded}
          onRetry={() => {
            if (failed.has(current ? failureKey(current, selection.lineIdx) : '')) {
              setFailed(new Set());
            }
            setRetryKey((n) => n + 1);
          }}
          onPlaying={() => setFailed(new Set())} />
      </div>
      <div className="player-below">
        <div className="player-info">
          <div className="player-info-main">
            <div className="t">{current?.sourceName} · {line?.name}</div>
            <div className="d">{epTotal > 1 ? `已选 ${episode.name} · 共 ${epTotal} 集` : '单集影片'}</div>
          </div>
          <button className="row-action" onClick={() => setShowLines((v) => !v)}>{showLines ? '收起' : '来源与线路'}</button>
        </div>
        {showLines && (
          <>
            <div className="group-title">来源（换源保留当前集数）</div>
            <div className="line-tabs">
              {item.variants.map((v, i) => (
                <button key={`${v.sourceKey}:${v.vodId}`} className={`line-tab${i === selection.variantIdx ? ' active' : ''}`}
                  onClick={() => changeSelection({ ...selection, variantIdx: i, lineIdx: 0 })}
                  aria-pressed={i === selection.variantIdx}>
                  {v.sourceName}
                </button>
              ))}
            </div>
            {current && current.lines.length > 1 && (
              <>
                <div className="group-title">同源线路</div>
                <div className="line-tabs">
                  {current.lines.map((l, i) => (
                    <button key={`${l.name}:${i}`} className={`line-tab${i === selection.lineIdx ? ' active' : ''}`}
                      onClick={() => changeSelection({ ...selection, lineIdx: i })} aria-pressed={i === selection.lineIdx}>
                      {l.direct && <span className="dot" />}{l.name} · {l.episodes.length}集
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {epTotal > 1 ? (
          <>
            <div className="ep-head"><span className="group-title" style={{ margin: 0 }}>选集</span><span className="ep-count">{selection.epIdx + 1} / {epTotal}</span></div>
            <div className="ep-grid">
              {line?.episodes.map((ep) => (
                <button key={ep.index} ref={ep.index === selection.epIdx ? activeEpRef : undefined}
                  className={`ep-btn${ep.index === selection.epIdx ? ' active' : ''}`}
                  onClick={() => changeSelection({ ...selection, epIdx: ep.index })} aria-current={ep.index === selection.epIdx ? 'true' : undefined}>{ep.name}</button>
              ))}
            </div>
          </>
        ) : <div className="hint">该来源只提供了 1 个可直接播放的地址。</div>}
        {failed.size > 0 && <button className="btn" style={{ marginTop: 14 }} onClick={() => { setFailed(new Set()); setRetryKey((n) => n + 1); }}>清除失败标记，重试当前线路</button>}
        {failed.size >= item.variants.reduce((sum, v) => sum + v.lines.length, 0) && (
          <div className="hint" style={{ color: 'var(--danger)' }}>已尝试全部来源与线路，仍无法播放。请重试，或检查网络后返回搜索。</div>
        )}
      </div>
    </div>
  );
}

function routeFrom(sp: URLSearchParams) {
  return { source: sp.get('source') || '', vodId: sp.get('vod') || undefined, line: nonNegativeInt(sp.get('line')), ep: nonNegativeInt(sp.get('ep')) };
}
function sameSelection(a: PlaySelection, b: PlaySelection) {
  return a.variantIdx === b.variantIdx && a.lineIdx === b.lineIdx && a.epIdx === b.epIdx;
}
function PlayerBar({ title, onBack }: { title: string; onBack: () => void }) {
  return <div className="player-bar"><button className="icon-btn" onClick={onBack} aria-label="返回"><BackIcon /></button><div className="player-title">{title}</div></div>;
}
function BackIcon() {
  return <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M15 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function SwitchIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 8h13l-3-3M21 16H8l3 3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
