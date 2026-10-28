import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import VodCard from '../components/VodCard';
import { useToast } from '../components/Toast';
import { fetchById, findSavedVariant, getItem, matchesSavedWork, playPath, putItems, recommendFor, searchAll, type AggregatedItem, type HistoryEntry } from '../core';
import { useApp } from '../state/AppState';

export default function Detail() {
  const { key = '' } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const { ready, sources, health, settings, history, toggleFav, isFavorite, restoreFavorites, persistHealth, setSearch } = useApp();
  const goHome = () => {
    // 小房子表示回到全新首页；返回键仍保留搜索快照供继续浏览。
    setSearch(null);
    nav('/', { replace: true });
  };
  const passed = (loc.state as { item?: AggregatedItem } | null)?.item;
  const meta = (loc.state as { meta?: { sourceKey: string; vodId: string } } | null)?.meta;
  const initialItem = passed ?? getItem(key);
  const [item, setItem] = useState<AggregatedItem | null>(initialItem);
  const [sourceIdx, setSourceIdx] = useState(() => initialItem && meta ? Math.max(0, findSavedVariant(initialItem, { key, name: initialItem.name, ...meta })) : 0);
  const [lineIdx, setLineIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [rec, setRec] = useState<{ key: string; items: AggregatedItem[] } | null>(null);
  const name = sp.get('name') || item?.name || decodeWorkName(key);

  useEffect(() => {
    const next = (loc.state as { item?: AggregatedItem } | null)?.item ?? getItem(key);
    setItem(next ?? null);
    setSourceIdx(next && meta ? Math.max(0, findSavedVariant(next, { key, name: next.name, ...meta })) : 0);
    setLineIdx(0);
    setRec(null);
  }, [key]);

  // 冷启动优先用精确 source+vod 回源；失败才全量搜索，不随便选一部同名影片。
  useEffect(() => {
    if (item || !ready) return;
    let alive = true;
    const ctl = new AbortController();
    setLoading(true);
    void (async () => {
      const source = meta ? sources.find((s) => s.key === meta.sourceKey) : undefined;
      if (source && meta) {
        const agg = await fetchById(source, meta.vodId, { health, timeoutMs: settings.timeoutMs, signal: ctl.signal });
        if (!alive) return;
        if (agg && matchesSavedWork(agg, { key, name, year: sp.get('year') || '', ...meta })) {
          putItems([agg]);
          setItem(agg);
          setSourceIdx(findSavedVariant(agg, { key, name, ...meta }));
          setLoading(false);
          return;
        }
      }
      const res = await searchAll(name, { sources, health, timeoutMs: settings.timeoutMs, signal: ctl.signal });
      if (!alive) return;
      putItems(res.items);
      persistHealth();
      const hit = res.items.find((i) => i.key === key || (meta && matchesSavedWork(i, { key, name, year: sp.get('year') || '', ...meta })));
      setItem(hit ?? null);
      if (hit && meta) setSourceIdx(Math.max(0, findSavedVariant(hit, { key, name, ...meta })));
      setLoading(false);
    })().catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; ctl.abort(); };
  }, [item, name, key, ready, sources, health, settings.timeoutMs, persistHealth, meta, sp]);

  const current = item?.variants[sourceIdx] ?? null;
  const line = current?.lines[lineIdx] ?? null;
  const hist = item && current ? history.find((h) =>
    h.sourceKey === current.sourceKey && h.vodId === current.vodId && matchesSavedWork(item, h),
  ) : undefined;
  const continueFrom = hist;

  useEffect(() => {
    if (!item) return;
    const variant = item.variants[0];
    const source = sources.find((s) => s.key === variant?.sourceKey);
    if (!source) return;
    const ctl = new AbortController();
    const keyAtStart = item.key;
    void recommendFor(item, { source, timeoutMs: settings.timeoutMs, signal: ctl.signal }).then((items) => {
      if (!ctl.signal.aborted) setRec({ key: keyAtStart, items });
    });
    return () => ctl.abort();
  }, [item, sources, settings.timeoutMs]);

  if (loading) return <div className="page page-plain"><div className="empty"><div className="spinner" style={{ margin: '0 auto 12px' }} /><div>正在获取线路…</div><button className="btn" style={{ maxWidth: 180, margin: '16px auto' }} onClick={() => nav(-1)}>取消并返回</button></div></div>;
  if (!item) return (
    <div className="page page-plain">
      <div className="detail-topbar"><button className="icon-btn" style={{ background: 'var(--bg-card)' }} onClick={() => nav(-1)} aria-label="返回"><BackIcon /></button><button className="icon-btn" style={{ background: 'var(--bg-card)' }} onClick={goHome} aria-label="回到首页"><HomeIcon /></button></div>
      <div className="empty"><div className="empty-icon">📭</div><div>未找到该影片</div><div className="hint">可能来源已失效，请返回重新搜索</div><button className="btn primary" style={{ maxWidth: 220 }} onClick={() => nav(`/?q=${encodeURIComponent(name)}`)}>重新搜索</button></div>
    </div>
  );

  const fav = current ? isFavorite({ key: item.key, sourceKey: current.sourceKey, vodId: current.vodId }) : false;
  const startPlay = (ep: number, resume?: HistoryEntry) => {
    const selection = { variantIdx: sourceIdx, lineIdx, epIdx: Math.min(ep, Math.max(0, (line?.episodes.length ?? 1) - 1)) };
    nav(playPath(item, selection), { state: { item, resumeAt: resume?.position ?? 0 } });
  };

  return (
    <div className="page page-plain">
      <div className="detail-topbar">
        <button className="icon-btn" style={{ background: 'var(--bg-card)' }} onClick={() => nav(-1)} aria-label="返回"><BackIcon /></button>
        <button className="icon-btn" style={{ background: 'var(--bg-card)' }} onClick={goHome} aria-label="回到首页"><HomeIcon /></button>
      </div>
      <div className="detail-hero">
        {item.pic && <div className="detail-bg" style={{ backgroundImage: `url("${item.pic}")` }} />}
        <div className="detail-top">
          {item.pic ? <img className="detail-poster" src={item.pic} alt={item.name} referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <div className="detail-poster poster-fallback">{item.name.slice(0, 3)}</div>}
          <div className="detail-info">
            <h1 className="detail-name">{item.name}</h1>
            <div className="detail-tags">
              {item.score > 0 && <span className="tag score">★ {item.score.toFixed(1)} {item.scoreSource === 'site' ? '站内评分' : '豆瓣评分'}</span>}
              {current?.year && <span className="tag">{current.year}</span>}
              {current?.area && <span className="tag">{current.area}</span>}
              {current?.typeName && <span className="tag">{current.typeName.split(/[\/,]/)[0]}</span>}
              <span className="tag">{item.variants.length} 个来源</span>
            </div>
            {current?.remarks && <div className="detail-line">{current.remarks}</div>}
            {current?.director && <div className="detail-line">导演：{current.director}</div>}
            {current?.actor && <div className="detail-line">主演：{current.actor.slice(0, 100)}</div>}
          </div>
        </div>
      </div>
      <div className="btn-row">
        <button className="btn primary" onClick={() => startPlay(continueFrom?.episodeIndex ?? 0, continueFrom)}><PlayIcon />{continueFrom ? (line?.episodes.length ?? 0) > 1 ? continueFrom.position > 60 ? `第${continueFrom.episodeIndex + 1}集 从 ${fmtPos(continueFrom.position)} 继续` : `继续观看 第${continueFrom.episodeIndex + 1}集` : '继续观看' : '播放'}</button>
        <button className={`btn ghost${fav ? ' active' : ''}`} style={{ flex: '0 0 96px' }} aria-pressed={fav} onClick={() => {
          const src = current ?? item.variants[0];
          const entry = { key: item.key, name: item.name, pic: item.pic, year: src?.year ?? '', remarks: src?.remarks ?? '', sourceKey: src?.sourceKey ?? '', sourceName: src?.sourceName ?? '', vodId: src?.vodId ?? '', addedAt: Date.now() };
          toggleFav(entry);
          toast(fav ? '已取消收藏' : '已加入收藏', fav ? { label: '撤销', onClick: () => restoreFavorites([entry]) } : undefined);
        }}><StarIcon filled={fav} />{fav ? '已收藏' : '收藏'}</button>
      </div>
      <div className="group-title">播放来源</div>
      <div className="line-tabs">{item.variants.map((v, i) => <button key={`${v.sourceKey}:${v.vodId}`} className={`line-tab${i === sourceIdx ? ' active' : ''}`} aria-pressed={i === sourceIdx} onClick={() => { setSourceIdx(i); setLineIdx(0); }}>{v.lines.some((l) => l.direct) && <span className="dot" />}{v.sourceName}<span style={{ opacity: 0.6, marginLeft: 4 }}>{v.lines[0]?.episodes.length}集</span></button>)}</div>
      {current && current.lines.length > 1 && <><div className="group-title">同源线路</div><div className="line-tabs">{current.lines.map((l, i) => <button key={`${l.name}:${i}`} className={`line-tab${i === lineIdx ? ' active' : ''}`} aria-pressed={i === lineIdx} onClick={() => setLineIdx(i)}>{l.name} · {l.episodes.length}集</button>)}</div></>}
      <div className="group-title">选集</div>
      <div className="ep-grid">{line?.episodes.map((ep) => <button key={ep.index} className="ep-btn" onClick={() => startPlay(ep.index)}>{ep.name}</button>)}</div>
      {current?.content && <><div className="section-head"><span className="section-title">剧情简介</span></div><div className="synopsis">{current.content}</div></>}
      {rec && rec.key === item.key && rec.items.length > 0 && <><div className="section-head"><span className="section-title">猜你喜欢</span><span className="section-more">同类型 · 同演员</span></div><div className="grid">{rec.items.map((r) => <VodCard key={r.key} item={r} showSources={false} onClick={() => { putItems([r]); nav(`/detail/${encodeURIComponent(r.key)}?name=${encodeURIComponent(r.name)}`, { state: { item: r } }); }} />)}</div></>}
    </div>
  );
}

function decodeWorkName(key: string) { return key.split('~')[0]; }
function fmtPos(sec: number): string {
  const s = Math.floor(sec % 60), m = Math.floor((sec / 60) % 60), h = Math.floor(sec / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function HomeIcon() { return <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function BackIcon() { return <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M15 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function PlayIcon() { return <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="currentColor" /></svg>; }
function StarIcon({ filled }: { filled: boolean }) { return <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3l2.6 5.9 6.4.6-4.8 4.2 1.4 6.3L12 16.8 6.4 20l1.4-6.3L3 9.5l6.4-.6z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>; }
