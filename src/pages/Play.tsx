import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Player from '../components/Player';
import { useToast } from '../components/Toast';
import { getItem, localPlaylistUrl, putItems, searchAll, type AggregatedItem } from '../core';
import { useApp } from '../state/AppState';

export default function Play() {
  const { key = '' } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const { sources, health, settings, history, rememberPlay, persistHealth, cachedEpisode } = useApp();

  const passed = (loc.state as { item?: AggregatedItem } | null)?.item;
  const [item, setItem] = useState<AggregatedItem | null>(passed ?? getItem(key));
  const [lineIdx, setLineIdx] = useState(Math.max(0, Number(sp.get('line') ?? 0)));
  const [epIdx, setEpIdx] = useState(Math.max(0, Number(sp.get('ep') ?? 0)));
  /** 已自动尝试失败的来源，避免死循环 */
  const [failedSources, setFailedSources] = useState<string[]>([]);
  /** 是否展开来源线路列表（低频操作，默认收起，把空间让给选集） */
  const [showLines, setShowLines] = useState(false);
  /** 按片名重新搜索后确实没有这个条目，用来区分「还在搜」与「搜不到」 */
  const [notFound, setNotFound] = useState(false);

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
      /*
       * 只接受精确匹配，绝不能回退到 res.items[0]。
       * key 由片名归一化而来，匹配不到就说明这个片名在当前源里已经没有了；
       * 此时随便挑第一条会播出一部毫不相干的影片。
       */
      const hit = res.items.find((i) => i.key === key) ?? null;
      setItem(hit);
      // 搜索已经结束且确实没有这个条目：要显示「未找到」，而不是一直转圈
      setNotFound(!hit);
    })();
    return () => {
      alive = false;
    };
  }, [item, name, key, sources, health, settings.timeoutMs, persistHealth]);

  const current = useMemo(() => item?.variants[lineIdx] ?? null, [item, lineIdx]);
  const line = current?.lines[0] ?? null;
  const epTotal = line?.episodes.length ?? 0;
  /*
   * 统一用夹紧后的集号，而不是直接用 epIdx。
   * 换源后各站的集数可能不同（46 集 / 40 集），若不夹紧就会出现
   * 「高亮停在第 44 集、实际加载第 40 集」这种错位。全流程只认 epIndex。
   */
  const epIndex = Math.min(epIdx, Math.max(0, epTotal - 1));
  const episode = line?.episodes[epIndex] ?? null;

  /*
   * 离线优先：这一集若已缓存，直接播本地文件。
   *
   * 关键是**先判断再决定 src**，不能让播放器先去试在线地址：
   * 没网时在线请求要等全部超时重试才失败，用户看到的是长时间的
   * 「正在缓冲」——而离线场景恰恰是这个功能存在的意义。
   */
  const cached = item && episode ? cachedEpisode(item.key, epIndex) : undefined;
  const [localSrc, setLocalSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!cached) {
      setLocalSrc(null);
      return;
    }
    let alive = true;
    void (async () => {
      const url = await localPlaylistUrl(cached);
      // 生成失败（如文件被系统清理）时保持 null，自动回退在线播放
      if (alive) setLocalSrc(url);
    })();
    return () => {
      alive = false;
    };
  }, [cached]);

  // 续播：仅当历史记录的集数与当前集一致时才跳转
  const hist = item ? history.find((h) => h.key === item.key) : undefined;
  const startAt = hist && hist.episodeIndex === epIndex ? hist.position : 0;

  /*
   * 切集后把当前集滚入视野。
   *
   * 长剧集动辄上百集，网格要滚好几屏。若不自动定位，用户切到第 60 集后
   * 下次进来还得自己找「播到哪一集了」。block:'nearest' 保证只滚动最近的
   * 滚动容器（即下方的播放信息区），不会把整个播放器顶出屏幕。
   */
  const activeEpRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeEpRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [epIndex, lineIdx]);

  const onProgress = (position: number, duration: number) => {
    if (!item || !settings.recordHistory || !current || !episode) return;
    rememberPlay({
      key: item.key,
      name: item.name,
      pic: item.pic,
      sourceKey: current.sourceKey,
      sourceName: current.sourceName,
      vodId: current.vodId,
      episodeIndex: epIndex,
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
    if (next < 0 || next === lineIdx) return;

    /*
     * 换源时保留当前集号（按新线路的集数夹紧），不要重置到第 1 集。
     * 用户看到第 12 集时线路挂了，突然跳回第 1 集是明显的体验断裂；
     * 各站集号命名不同（第1集 / 第01集），所以只搬「序号」不搬名称。
     */
    const nextTotal = item.variants[next].lines[0]?.episodes.length ?? 1;
    toast(`线路不可用，已自动切换到「${item.variants[next].sourceName}」`);
    setLineIdx(next);
    setEpIdx(Math.max(0, Math.min(epIndex, nextTotal - 1)));
  };

  /** 播完自动进入下一集，追剧时不必每次退回选集手动点 */
  const onEnded = () => {
    if (epIdx + 1 < epTotal) {
      const nextIdx = epIdx + 1;
      const nextEp = line?.episodes[nextIdx];
      /*
       * 进度改为事件落盘后（不再每 5 秒写历史），自动连播必须立刻给新集
       * 建一条 0 进度记录：否则连播后直接锁屏/杀 App，历史仍停在上一集
       * 结尾，下次进来会重看上一集片尾。
       */
      if (item && current && settings.recordHistory && nextEp) {
        rememberPlay({
          key: item.key,
          name: item.name,
          pic: item.pic,
          sourceKey: current.sourceKey,
          sourceName: current.sourceName,
          vodId: current.vodId,
          episodeIndex: nextIdx,
          episodeName: nextEp.name,
          position: 0,
          duration: 0,
          updatedAt: Date.now(),
        });
      }
      setEpIdx(nextIdx);
    }
  };

  if (!item) {
    // 还在搜索 → 转圈；已搜完且没有 → 明确报未找到，避免一直转圈
    if (!notFound) {
      return (
        <div className="player-page">
          <div className="empty" style={{ margin: 'auto' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            <div>正在获取播放地址…</div>
          </div>
        </div>
      );
    }
    return (
      <div className="player-page">
        <div className="player-bar">
          <button className="icon-btn" onClick={() => nav(-1)} aria-label="返回">
            <BackIcon />
          </button>
        </div>
        <div className="empty" style={{ margin: 'auto' }}>
          <div className="empty-icon">📭</div>
          <div>未找到「{name}」</div>
          <div className="hint">该片名在当前资源源里已不存在，请返回重新搜索</div>
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
        {item.variants.length > 1 && (
          <button
            className="icon-btn"
            onClick={() => setShowLines((v) => !v)}
            aria-label="切换来源"
            aria-expanded={showLines}
          >
            <SwitchIcon />
          </button>
        )}
      </div>

      <div className="player-stage">
        {/*
         * 已缓存但本地播放列表还没生成好时，先不挂播放器：
         * 这一瞬间若挂上会以在线地址起播，没网时又变成「一直缓冲」。
         * 生成很快（一两次原生桥调用），短暂占位即可。
         */}
        {cached && !localSrc ? (
          <div className="player-loading">
            <div className="spinner" />
            <div>正在读取本地缓存…</div>
          </div>
        ) : (
          <Player
            src={localSrc ?? episode.url}
            startAt={startAt}
            autoPlay
            onProgress={onProgress}
            onError={onError}
            onEnded={onEnded}
            /*
             * 起播成功即宣告当前线路恢复：清空全部失败标记。
             * 否则「所有来源均失败 → 手动点回某个源重试成功」后，
             * 该源仍带着死亡记录（透明度 0.5、下次被自动换源跳过）。
             */
            onPlaying={() => setFailedSources([])}
          />
        )}
      </div>

      <div className="player-below">
        <div className="player-info">
          <div className="player-info-main">
            <div className="t">
              {current?.sourceName}
              {cached && <span className="badge-offline">已缓存</span>}
            </div>
            <div className="d">
              {epTotal > 1 ? `已选 ${episode.name} · 共 ${epTotal} 集` : '单集影片'}
            </div>
          </div>
          {item.variants.length > 1 && (
            <button className="row-action" onClick={() => setShowLines((v) => !v)}>
              {showLines ? '收起' : `切换来源 ${item.variants.length}`}
            </button>
          )}
        </div>

        {showLines && (
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
                      // 失败过的源仍允许手动重试（临时故障很常见），但要明说，别让用户对着半透明按钮猜
                      if (dead && i !== lineIdx) {
                        toast(`「${v.sourceName}」刚才失败过，正在重试；成功后会自动恢复标记`);
                      }
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
          </>
        )}

        {/*
          选集常驻显示，不再折叠。
          用户从详情页进来就是为了接着往下看，选集是这里最高频的操作，
          藏进「切换」按钮后面等于让每次切集都多两步。
        */}
        {epTotal > 1 ? (
          <>
            <div className="ep-head">
              <span className="group-title" style={{ margin: 0 }}>
                选集
              </span>
              <span className="ep-count">
                {epIndex + 1} / {epTotal}
              </span>
            </div>
            <div className="ep-grid">
              {line?.episodes.map((ep) => {
                const active = ep.index === epIndex;
                return (
                  <button
                    key={ep.index}
                    ref={active ? activeEpRef : undefined}
                    className={`ep-btn${active ? ' active' : ''}`}
                    onClick={() => setEpIdx(ep.index)}
                    aria-current={active ? 'true' : undefined}
                  >
                    {ep.name}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="hint">该来源只提供了 1 个可直接播放的地址。</div>
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
