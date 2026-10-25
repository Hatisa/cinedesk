import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { getItem, searchAll, putItems, type AggregatedItem } from '../core';
import { useApp } from '../state/AppState';

export default function Detail() {
  const { key = '' } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const { sources, health, settings, history, toggleFav, isFavorite, persistHealth } = useApp();

  const passed = (loc.state as { item?: AggregatedItem } | null)?.item;
  const [item, setItem] = useState<AggregatedItem | null>(passed ?? getItem(key));
  const [lineIdx, setLineIdx] = useState(0);
  const [epIdx, setEpIdx] = useState(0);
  const [loading, setLoading] = useState(false);

  const name = sp.get('name') || item?.name || '';

  // 直接打开链接（或进程被回收后恢复）时缓存可能已失效，用片名重新搜索
  useEffect(() => {
    if (item || !name) return;
    let alive = true;
    setLoading(true);
    (async () => {
      const res = await searchAll(name, { sources, health, timeoutMs: settings.timeoutMs });
      putItems(res.items);
      persistHealth();
      if (!alive) return;
      setItem(res.items.find((i) => i.key === key) ?? res.items[0] ?? null);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [item, name, key, sources, health, settings.timeoutMs, persistHealth]);

  // 默认选第一条直链线路的第一集
  const current = useMemo(() => item?.variants[lineIdx] ?? null, [item, lineIdx]);
  useEffect(() => setEpIdx(0), [lineIdx]);

  if (loading) {
    return (
      <div className="page page-plain">
        <div className="empty">
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <div>正在获取线路…</div>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="page page-plain">
        <button className="icon-btn" style={{ background: 'var(--bg-card)' }} onClick={() => nav(-1)}>
          <BackIcon />
        </button>
        <div className="empty">
          <div className="empty-icon">📭</div>
          <div>未找到该影片</div>
          <div className="hint">可能来源已失效，请返回重新搜索</div>
        </div>
      </div>
    );
  }

  const fav = isFavorite(item.key);
  const continueFrom = history.find((h) => h.key === item.key);

  const startPlay = (line: number, ep: number) => {
    nav(
      `/play/${encodeURIComponent(item.key)}?source=${encodeURIComponent(current?.sourceKey ?? '')}&line=${line}&ep=${ep}`,
      { state: { item } },
    );
  };

  return (
    <div className="page page-plain">
      <button
        className="icon-btn"
        style={{ background: 'var(--bg-card)', marginBottom: 10 }}
        onClick={() => nav(-1)}
        aria-label="返回"
      >
        <BackIcon />
      </button>

      <div className="detail-hero">
        {item.pic && (
          <div className="detail-bg" style={{ backgroundImage: `url("${item.pic}")` }} />
        )}
        <div className="detail-top">
          {item.pic ? (
            <img
              className="detail-poster"
              src={item.pic}
              alt={item.name}
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="detail-poster poster-fallback">{item.name.slice(0, 3)}</div>
          )}
          <div className="detail-info">
            <h1 className="detail-name">{item.name}</h1>
            <div className="detail-tags">
              {item.score > 0 && <span className="tag score">★ {item.score.toFixed(1)}</span>}
              {current?.year && <span className="tag">{current.year}</span>}
              {current?.area && <span className="tag">{current.area}</span>}
              {current?.typeName && <span className="tag">{current.typeName.split(/[\/,]/)[0]}</span>}
              <span className="tag">{item.variants.length} 个来源</span>
            </div>
            {current?.remarks && <div className="detail-line">{current.remarks}</div>}
            {current?.director && <div className="detail-line">导演：{current.director}</div>}
            {current?.actor && <div className="detail-line">主演：{current.actor.slice(0, 60)}</div>}
          </div>
        </div>
      </div>

      <div className="btn-row">
        <button className="btn primary" onClick={() => startPlay(lineIdx, continueFrom?.episodeIndex ?? 0)}>
          <PlayIcon />
          {continueFrom ? `继续观看 第${continueFrom.episodeIndex + 1}集` : '播放'}
        </button>
        <button
          className={`btn ghost${fav ? ' active' : ''}`}
          style={{ flex: '0 0 96px' }}
          onClick={() => {
            const src = item.variants[0];
            toggleFav({
              key: item.key,
              name: item.name,
              pic: item.pic,
              year: src?.year ?? '',
              remarks: src?.remarks ?? '',
              sourceKey: src?.sourceKey ?? '',
              sourceName: src?.sourceName ?? '',
              vodId: src?.vodId ?? '',
              addedAt: Date.now(),
            });
            toast(fav ? '已取消收藏' : '已加入收藏');
          }}
        >
          <StarIcon filled={fav} />
          {fav ? '已收藏' : '收藏'}
        </button>
      </div>

      <div className="group-title">播放来源</div>
      <div className="line-tabs">
        {item.variants.map((v, i) => (
          <button
            key={v.sourceKey}
            className={`line-tab${i === lineIdx ? ' active' : ''}`}
            onClick={() => setLineIdx(i)}
          >
            {v.lines.some((l) => l.direct) && <span className="dot" />}
            {v.sourceName}
            <span style={{ opacity: 0.6, marginLeft: 4 }}>{v.lines[0]?.episodes.length}集</span>
          </button>
        ))}
      </div>

      <div className="group-title">选集</div>
      <div className="ep-grid">
        {current?.lines[0]?.episodes.map((ep) => (
          <button
            key={ep.index}
            className={`ep-btn${ep.index === epIdx ? ' active' : ''}`}
            onClick={() => {
              setEpIdx(ep.index);
              startPlay(lineIdx, ep.index);
            }}
          >
            {ep.name}
          </button>
        ))}
      </div>

      {current && current.lines.length > 1 && (
        <div className="hint">该来源提供 {current.lines.length} 条线路，播放页可随时切换</div>
      )}

      {current?.content && (
        <>
          <div className="section-head">
            <span className="section-title">剧情简介</span>
          </div>
          <div className="synopsis">{current.content}</div>
        </>
      )}
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

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M7 4l13 8-13 8z" fill="currentColor" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M12 3l2.6 5.9 6.4.6-4.8 4.2 1.4 6.3L12 16.8 6.4 20l1.4-6.3L3 9.5l6.4-.6z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
