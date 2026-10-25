import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import VodCard from '../components/VodCard';
import { useToast } from '../components/Toast';
import { getItem, putItems, recommendFor, searchAll, type AggregatedItem } from '../core';
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
  /*
   * 推荐结果连同「它属于哪部影片」一起存。
   * 只存数组的话，切到另一部影片的瞬间会先渲染出上一部的推荐，
   * 看上去像是推荐错了；带上 key 就能在数据到齐前不渲染这一块。
   */
  const [rec, setRec] = useState<{ key: string; items: AggregatedItem[] } | null>(null);

  const name = sp.get('name') || item?.name || '';

  /*
   * 路由参数变化时重置页面状态。
   *
   * 从「猜你喜欢」点进另一部影片走的是同一个路由（/detail/:key），
   * react-router 会复用组件实例，useState 的初始值不会再执行一次，
   * 结果就是地址变了、页面还停在上一部。这里显式按 key 重建：
   * state 里带了条目就用它，否则回退到内存缓存。
   */
  useEffect(() => {
    const next = (loc.state as { item?: AggregatedItem } | null)?.item ?? getItem(key);
    setItem(next ?? null);
    setLineIdx(0);
    setEpIdx(0);
    setRec(null);
    // loc.state 由导航动作给出，跟着 key 一起变，不需要单独成为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

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
      /*
       * 只接受精确匹配，绝不能回退到 res.items[0]。
       * key 由片名归一化而来，匹配不到就说明这个片名在当前源里已经没有了；
       * 此时随便挑第一条会把用户带到一部毫不相干的影片上，比报「未找到」更糟。
       */
      setItem(res.items.find((i) => i.key === key) ?? null);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [item, name, key, sources, health, settings.timeoutMs, persistHealth]);

  // 默认选第一条直链线路的第一集
  const current = useMemo(() => item?.variants[lineIdx] ?? null, [item, lineIdx]);
  useEffect(() => setEpIdx(0), [lineIdx]);

  /*
   * 「猜你喜欢」。
   *
   * 依赖刻意只放 item.key / item.name 这类稳定值，不放 item 本身：
   * 推荐结果会写回 item 之外的 state，若把 item 放进依赖会造成重复请求。
   *
   * 用当前线路所属的源去查候选——分类 id（ac=list 返回的 type_id）是各源
   * 私有的，拿 A 源的 id 去查 B 源会得到完全不相干的结果。
   */
  useEffect(() => {
    if (!item) return;
    const variant = item.variants[0];
    if (!variant) return;

    /*
     * 必须用列表里那份真实的源配置：分类 id 是各源私有的，而 recommendFor
     * 还要拿 source.api 去请求。不能就地拼一个只有 key/name 的对象——
     * 那样 api 是空的，请求必然失败。
     */
    const source = sources.find((s) => s.key === variant.sourceKey);
    if (!source) return;

    const signal = { aborted: false };
    const keyAtStart = item.key;
    void (async () => {
      const items = await recommendFor(item, {
        source,
        timeoutMs: settings.timeoutMs,
        signal,
      });
      if (signal.aborted) return;
      setRec({ key: keyAtStart, items });
    })();

    return () => {
      signal.aborted = true;
    };
  }, [item, sources, settings.timeoutMs]);

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

  /*
   * 点「猜你喜欢」里的一部影片。
   *
   * 走的是同一个路由（/detail/:key），react-router 会复用组件实例而不是重新挂载，
   * 因此必须把完整条目放进 state 传过去，并由下面的 key 变化 effect 重置页面状态；
   * 只改 URL 的话，页面会继续显示上一部影片的内容。
   */
  const openRec = (r: AggregatedItem) => {
    putItems([r]);
    nav(`/detail/${encodeURIComponent(r.key)}?name=${encodeURIComponent(r.name)}`, {
      state: { item: r },
    });
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

      {/*
        「猜你喜欢」。rec 用 key 与当前影片比对，数据没到时整块不渲染——
        推荐位宁可晚一点出现，也不能闪出上一部影片的推荐。
      */}
      {rec && rec.key === item.key && rec.items.length > 0 && (
        <>
          <div className="section-head">
            <span className="section-title">猜你喜欢</span>
            <span className="section-more">同类型 · 同演员</span>
          </div>
          <div className="grid">
            {rec.items.map((r) => (
              <VodCard key={r.key} item={r} onClick={() => openRec(r)} showSources={false} />
            ))}
          </div>
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
