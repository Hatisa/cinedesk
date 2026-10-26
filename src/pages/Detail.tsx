import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import VodCard from '../components/VodCard';
import { useToast } from '../components/Toast';
import { fetchById, getItem, putItems, recommendFor, searchAll, type AggregatedItem } from '../core';
import { useApp } from '../state/AppState';
import { useDownload } from '../state/downloadManager';

export default function Detail() {
  const { key = '' } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const { sources, health, settings, history, toggleFav, isFavorite, persistHealth } = useApp();
  const { enqueue, isQueued, isCached, taskOf } = useDownload();
  /** 缓存选择模式：开启后点选集是把该集加入缓存，而不是直接播放 */
  const [cacheMode, setCacheMode] = useState(false);
  /** 缓存模式下已勾选的集号 */
  const [picked, setPicked] = useState<Set<number>>(new Set());

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

  // 直接打开链接（或进程被回收后恢复）时缓存可能已失效。
  // 收藏/历史直进时 state 里带了 sourceKey+vodId，走单源详情查询即可（一次请求）；
  // 单源拿不到（源挂了/已下架/未启用）才回退到按片名全量搜索。
  useEffect(() => {
    if (item || !name) return;
    let alive = true;
    const meta = (loc.state as { meta?: { sourceKey: string; vodId: string } } | null)?.meta;
    const source = meta ? sources.find((s) => s.key === meta.sourceKey) : undefined;

    setLoading(true);
    void (async () => {
      if (source && meta) {
        const agg = await fetchById(source, meta.vodId, { health, timeoutMs: settings.timeoutMs });
        if (!alive) return;
        // key 必须与路由一致才采用；不一致说明源里该片已改名，走全量兜底
        if (agg && agg.key === key) {
          putItems([agg]);
          persistHealth();
          setItem(agg);
          setLoading(false);
          return;
        }
      }
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
        <div className="detail-topbar">
          <button className="icon-btn" style={{ background: 'var(--bg-card)' }} onClick={() => nav(-1)}>
            <BackIcon />
          </button>
          <button className="icon-btn" style={{ background: 'var(--bg-card)' }} onClick={() => nav('/')}>
            <HomeIcon />
          </button>
        </div>
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

  /**
   * 只有 HLS 分片能缓存。
   *
   * 缓存走的是「下载播放列表 → 逐个拉分片」，因此必须拿到 .m3u8 地址。
   * 部分线路只给出播放页地址（需二次解析才能得到真实地址），这类无法
   * 直接缓存——若放进去，下载会在解析阶段失败，用户只会看到一条莫名其妙的错误。
   */
  const canCache = (url: string): boolean => /\.m3u8(\?|#|$)/i.test(url);

  /** 把选中的集加入缓存队列 */
  const cachePicked = () => {
    const line = current?.lines[0];
    if (!item || !current || !line || !picked.size) return;

    const jobs = [...picked]
      .sort((a, b) => a - b)
      .map((i) => {
        const ep = line.episodes[i];
        return ep && {
          key: item.key,
          name: item.name,
          pic: item.pic,
          year: item.year,
          typeName: item.typeName,
          epIndex: ep.index,
          epName: ep.name,
          url: ep.url,
          sourceKey: current.sourceKey,
          sourceName: current.sourceName,
          lineName: line.name,
        };
      })
      .filter((j): j is NonNullable<typeof j> => !!j && canCache(j.url));

    if (!jobs.length) {
      toast('选中的剧集暂不支持缓存（片源未提供分片地址）');
      return;
    }
    enqueue(jobs);
    toast(
      jobs.length < picked.size
        ? `已加入缓存队列 ${jobs.length} 集，其余 ${picked.size - jobs.length} 集暂不支持缓存`
        : `已加入缓存队列 ${jobs.length} 集，可在「缓存」页查看进度`,
    );
    setPicked(new Set());
    setCacheMode(false);
  };

  /** 全选/取消全选：只勾可缓存的集，避免用户白选一通再被过滤 */
  const togglePickAll = () => {
    const line = current?.lines[0];
    if (!line) return;
    const usable = line.episodes.filter((e) => canCache(e.url)).map((e) => e.index);
    setPicked((prev) => (prev.size >= usable.length ? new Set() : new Set(usable)));
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
      <div className="detail-topbar">
        <button
          className="icon-btn"
          style={{ background: 'var(--bg-card)' }}
          onClick={() => nav(-1)}
          aria-label="返回"
        >
          <BackIcon />
        </button>
        {/* 层级深（详情→播放→详情…）且桌面浏览器没有实体返回键，给一条直达首页的兜底 */}
        <button
          className="icon-btn"
          style={{ background: 'var(--bg-card)' }}
          onClick={() => nav('/')}
          aria-label="回到首页"
        >
          <HomeIcon />
        </button>
      </div>

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
          {continueFrom
            ? (current?.lines[0]?.episodes.length ?? 0) > 1
              ? continueFrom.position > 60
                ? `第${continueFrom.episodeIndex + 1}集 从 ${fmtPos(continueFrom.position)} 继续`
                : `继续观看 第${continueFrom.episodeIndex + 1}集`
              : /* 电影没有集号，写「第1集」反而奇怪 */
                '继续观看'
            : '播放'}
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

      <div className="group-title">
        选集
        {/*
          缓存入口放在选集标题行内：用户想缓存时的心理动作就是
          「翻到选集这里选几集」，入口在同一条视线里最省事。
        */}
        <button className="group-action" onClick={() => setCacheMode((v) => !v)} type="button">
          {cacheMode ? '取消缓存' : '缓存'}
        </button>
      </div>

      {cacheMode && (
        <div className="cache-bar">
          <span className="cache-bar-tip">
            点选要缓存的剧集（可多选），已缓存与正在下载的不可重复选
          </span>
          <div className="cache-bar-btns">
            <button className="row-action" onClick={togglePickAll} type="button">
              全选
            </button>
            <button
              className="btn primary cache-go"
              onClick={cachePicked}
              disabled={!picked.size}
              type="button"
            >
              缓存 {picked.size ? `(${picked.size})` : ''}
            </button>
          </div>
        </div>
      )}

      <div className="ep-grid">
        {current?.lines[0]?.episodes.map((ep) => {
          const done = isCached(item.key, ep.index);
          const queued = isQueued(item.key, ep.index);
          const pickedNow = picked.has(ep.index);
          /*
           * 下载中的集直接显示百分比。
           * 用户点完缓存会退到这一页看选集，看不见进度就会怀疑没生效
           * ——「点了没反应」是最容易让人放弃的体验。
           */
          const task = queued ? taskOf(item.key, ep.index) : undefined;
          const epPct = task && task.total > 0 ? Math.floor((task.done / task.total) * 100) : 0;
          const cls = [
            'ep-btn',
            ep.index === epIdx && !cacheMode ? 'active' : '',
            pickedNow ? 'picked' : '',
            done ? 'cached' : '',
            queued ? 'queued' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={ep.index}
              className={cls}
              disabled={queued}
              onClick={() => {
                if (!cacheMode) {
                  setEpIdx(ep.index);
                  startPlay(lineIdx, ep.index);
                  return;
                }
                // 已缓存的集不再勾选，避免重复下载白白耗流量
                if (done) {
                  toast('该集已缓存');
                  return;
                }
                setPicked((prev) => {
                  const next = new Set(prev);
                  if (next.has(ep.index)) next.delete(ep.index);
                  else next.add(ep.index);
                  return next;
                });
              }}
            >
              {ep.name}
              {done && <span className="ep-flag">已存</span>}
              {queued && (
                <span className="ep-flag">{epPct > 0 ? `${epPct}%` : '下载中'}</span>
              )}
            </button>
          );
        })}
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

/** 秒数格式化为 m:ss / h:mm:ss，用于「从 X 继续」按钮 */
function fmtPos(sec: number): string {
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const ss = String(s).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
      <path
        d="M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
