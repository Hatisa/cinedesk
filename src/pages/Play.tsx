import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Player from '../components/Player';
import { useToast } from '../components/Toast';
import { getItem, putItems, searchAll, type AggregatedItem } from '../core';
import { useApp } from '../state/AppState';

export default function Play() {
  const { key = '' } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const { sources, health, settings, history, rememberPlay, persistHealth } = useApp();

  const passed = (loc.state as { item?: AggregatedItem } | null)?.item;
  const [item, setItem] = useState<AggregatedItem | null>(passed ?? getItem(key));
  const [lineIdx, setLineIdx] = useState(Math.max(0, Number(sp.get('line') ?? 0)));
  const [epIdx, setEpIdx] = useState(Math.max(0, Number(sp.get('ep') ?? 0)));
  /** 已自动尝试失败的来源，避免死循环 */
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);

  const name = sp.get('name') || item?.name || '';

  // 缓存失效时（进程被回收后恢复、或直接打开链接）用片名重新拉取
  useEffect(() => {
    if (item || !name) return;
    let alive = true;
    (async () => {
      const res = await searchAll(name, { sources, health, timeoutMs: settings.timeoutMs });
      putItems(res.items);
      persistHealth();
      if (!alive) return;
      setItem(res.items.find((i) => i.key === key) ?? res.items[0] ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [item, name, key, sources, health, settings.timeoutMs, persistHealth]);

  const current = useMemo(() => item?.variants[lineIdx] ?? null, [item, lineIdx]);
  const line = current?.lines[0] ?? null;
  const episode = line?.episodes[Math.min(epIdx, (line?.episodes.length ?? 1) - 1)] ?? null;

  // 续播：仅当历史记录的集数与当前集一致时才跳转
  const hist = item ? history.find((h) => h.key === item.key) : undefined;
  const startAt = hist && hist.episodeIndex === epIdx ? hist.position : 0;

  const onProgress = (position: number, duration: number) => {
    if (!item || !settings.recordHistory || !current || !episode) return;
    rememberPlay({
      key: item.key,
      name: item.name,
      pic: item.pic,
      sourceKey: current.sourceKey,
      sourceName: current.sourceName,
      vodId: current.vodId,
      episodeIndex: epIdx,
      episodeName: episode.name,
      position,
      duration,
      updatedAt: Date.now(),
    });
  };

  /**
   * 线路不可用时自动换源——这是多源聚合最直接的用户价值：
   * 单条线路挂掉不需要用户自己处理，后台已经换到下一条可用线路。
   */
  const onError = () => {
    if (!item) return;
    const failed = current ? [...failedSources, current.sourceKey] : failedSources;
    setFailedSources(failed);
    const next = item.variants.findIndex((v) => !failed.includes(v.sourceKey));
    if (next >= 0 && next !== lineIdx) {
      toast(`线路不可用，已自动切换到「${item.variants[next].sourceName}」`);
      setLineIdx(next);
      setEpIdx(0);
    }
  };

  if (!item) {
    return (
      <div className="player-page">
        <div className="empty" style={{ margin: 'auto' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <div>正在获取播放地址…</div>
        </div>
      </div>
    );
  }

  if (!episode) {
    return (
      <div className="player-page">
        <div className="player-bar">
          <button className="icon-btn" onClick={() => nav(-1)} aria-label="返回">
            <BackIcon />
          </button>
          <div className="player-title">{item.name}</div>
        </div>
        <div className="empty" style={{ margin: 'auto' }}>
          <div className="empty-icon">🎞️</div>
          <div>该来源没有可直接播放的地址</div>
          <div className="hint">请返回详情页切换其他来源</div>
        </div>
      </div>
    );
  }

  const allFailed = item.variants.every((v) => failedSources.includes(v.sourceKey));

  return (
    <div className="player-page">
      <div className="player-bar">
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="返回">
          <BackIcon />
        </button>
        <div className="player-title">
          {item.name} · {episode.name}
        </div>
        <button
          className="icon-btn"
          onClick={() => setShowPicker((v) => !v)}
          aria-label="切换线路"
        >
          <SwitchIcon />
        </button>
      </div>

      <div className="player-stage">
        <Player
          src={episode.url}
          startAt={startAt}
          autoPlay
          onProgress={onProgress}
          onError={onError}
        />
      </div>

      <div className="player-below">
        <div className="setting-row" style={{ border: 'none', padding: '0 0 10px' }}>
          <div className="setting-label">
            <div className="t">{current?.sourceName}</div>
            <div className="d">
              {episode.url.replace(/^https?:\/\//, '').slice(0, 52)}
            </div>
          </div>
          <button className="row-action" onClick={() => setShowPicker((v) => !v)}>
            {showPicker ? '收起' : '切换'}
          </button>
        </div>

        {showPicker && (
          <>
            <div className="group-title">来源线路（失败会自动跳过）</div>
            <div className="line-tabs">
              {item.variants.map((v, i) => {
                const dead = failedSources.includes(v.sourceKey);
                return (
                  <button
                    key={v.sourceKey}
                    className={`line-tab${i === lineIdx ? ' active' : ''}`}
                    onClick={() => {
                      setLineIdx(i);
                      setEpIdx(0);
                    }}
                    style={dead ? { opacity: 0.5 } : undefined}
                  >
                    {!dead && <span className="dot" />}
                    {v.sourceName}
                  </button>
                );
              })}
            </div>

            <div className="group-title">选集（共 {line?.episodes.length ?? 0} 集）</div>
            <div className="ep-grid">
              {line?.episodes.map((ep) => (
                <button
                  key={ep.index}
                  className={`ep-btn${ep.index === epIdx ? ' active' : ''}`}
                  onClick={() => setEpIdx(ep.index)}
                >
                  {ep.name}
                </button>
              ))}
            </div>
          </>
        )}

        {allFailed && (
          <div className="hint" style={{ color: 'var(--danger)' }}>
            所有来源线路均无法播放。这类情况通常是资源站临时故障或网络受限，
            可返回搜索页换一个片名（不同资源站的片源不同）。
          </div>
        )}
      </div>
    </div>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
      <path
        d="M15 19l-7-7 7-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SwitchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M3 8h13l-3-3M21 16H8l3 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
