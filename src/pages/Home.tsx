import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import VodCard from '../components/VodCard';
import PosterImage from '../components/PosterImage';
import SearchFilterBar from '../components/SearchFilterBar';
import { useToast } from '../components/Toast';
import {
  FALLBACK_TRENDING,
  KEYS,
  TRENDING_TABS,
  expandCache,
  isFresh,
  loadLatestUpdates,
  loadRecent,
  loadTrendingCache,
  putItems,
  pushRecent,
  recommendFromSaved,
  refreshTrending,
  formatWatchTime,
  saveJSON,
  searchAll,
  watchProgress,
  EMPTY_SEARCH_FILTERS,
  filterSearchItems,
  groupSeries,
  isDerivative,
  searchSuggestions,
  onBack,
  onTabReset,
  type SearchFilters,
  type AggregatedItem,
  type HistoryEntry,
  type SourceStatus,
  type TrendingMap,
  type TrendingTab,
} from '../core';
import { useApp } from '../state/AppState';

/** 发现页（未搜索）的滚动位置，返回首页时用来还原浏览位置 */
const HOME_SCROLL_KEY = 'cinedesk:home-scroll';

const SORT_OPTIONS: { key: 'default' | 'score' | 'year'; label: string }[] = [
  { key: 'default', label: '综合' },
  { key: 'score', label: '评分' },
  { key: 'year', label: '最新' },
];

export default function Home() {
  const nav = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { sources, health, settings, history, favorites, persistHealth, ready, search, setSearch } = useApp();

  /*
   * 搜索状态从全局快照初始化：从详情页返回时组件会重新挂载，
   * 用快照把关键词、结果列表、进度文案原样恢复，用户看到的还是离开时的样子。
   */
  const [keyword, setKeyword] = useState(search?.keyword ?? '');
  const [items, setItems] = useState<AggregatedItem[]>(search?.items ?? []);
  const [statuses, setStatuses] = useState<SourceStatus[]>(search?.statuses ?? []);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(search !== null);
  const [totalMs, setTotalMs] = useState(search?.totalMs ?? 0);
  const [filters, setFilters] = useState<SearchFilters>(() => search?.filters ?? { ...EMPTY_SEARCH_FILTERS });
  const [mainOnly, setMainOnly] = useState(true);
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());
  const filteredItems = useMemo(() => filterSearchItems(items, filters), [items, filters]);
  const displayItems = useMemo(() => mainOnly ? filteredItems.filter((item) => !isDerivative(item)) : filteredItems, [filteredItems, mainOnly]);
  /*
   * 多源合并后的顺序由「哪个源先返回」决定，不是用户想看的相关性。
   * 主流视频 App 都提供「综合 / 评分 / 最新」排序，这里在前端做同样的事，不额外发请求。
   */
  const [sort, setSort] = useState<'default' | 'score' | 'year'>('default');
  const sortedItems = useMemo(() => {
    if (sort === 'default') return displayItems;
    const weight = (item: AggregatedItem) => sort === 'score' ? item.score : Number(item.year) || 0;
    // 片名命中的作品始终排在前面：搜「沙丘」时不希望纪录片《佐杜洛夫斯基的沙丘》因为分高而顶掉正片
    const query = keyword.trim();
    const hit = (item: AggregatedItem) => (query && item.name.includes(query) ? 0 : 1);
    return [...displayItems]
      .map((item, index) => ({ item, index }))
      .sort((a, b) => hit(a.item) - hit(b.item) || weight(b.item) - weight(a.item) || a.index - b.index)
      .map((entry) => entry.item);
  }, [displayItems, sort, keyword]);
  const searchEntries = useMemo(() => groupSeries(sortedItems), [sortedItems]);
  const derivativeCount = filteredItems.length - displayItems.length;
  const toggleSeries = (key: string) => setExpandedSeries((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const [recent, setRecent] = useState<string[]>([]);
  // 搜索历史持久化：此前只存在内存里，App 重启即失；现在落盘，重启后仍在
  useEffect(() => {
    let alive = true;
    void loadRecent().then((list) => {
      if (alive && list.length) setRecent(list);
    });
    return () => {
      alive = false;
    };
  }, []);
  const [trending, setTrending] = useState<TrendingMap>(FALLBACK_TRENDING);
  const [trendTab, setTrendTab] = useState<TrendingTab>('movie');
  const [continueList, setContinueList] = useState<HistoryEntry[]>(history.slice(0, 5));
  const [recommendItems, setRecommendItems] = useState<AggregatedItem[]>([]);
  const [latestItems, setLatestItems] = useState<AggregatedItem[]>([]);
  useEffect(() => {
    setContinueList(history.slice(0, 5));
    const latest = history[0] ?? (favorites[0] ? { key: favorites[0].key, sourceKey: favorites[0].sourceKey, vodId: favorites[0].vodId, name: favorites[0].name } : undefined);
    if (!latest) return;
    let alive = true;
    void recommendFromSaved(latest, { sources, health, timeoutMs: settings.timeoutMs })
      .then((items) => { if (alive && items.length) setRecommendItems(items); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [history, favorites, sources, health, settings.timeoutMs]);
  useEffect(() => {
    let alive = true;
    const ctl = new AbortController();
    void loadLatestUpdates({ sources, health, timeoutMs: settings.timeoutMs, signal: ctl.signal })
      .then((items) => { if (alive && items.length) setLatestItems(items); })
      .catch(() => undefined);
    return () => { alive = false; ctl.abort(); };
  }, [sources, health, settings.timeoutMs]);
  const inputRef = useRef<HTMLInputElement>(null);
  // 每次搜索递增，防止旧搜索的结果覆盖新搜索
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef(search?.scrollY ?? 0);
  const itemsRef = useRef(items);
  const statusesRef = useRef(statuses);
  const filtersRef = useRef(filters);
  itemsRef.current = items;
  statusesRef.current = statuses;
  filtersRef.current = filters;
  useEffect(() => {
    const savePosition = () => {
      scrollRef.current = window.scrollY;
      // 发现页也记住滚动位置：从详情页返回时不该被弹回顶部
      try { sessionStorage.setItem(HOME_SCROLL_KEY, String(window.scrollY)); } catch { /* 无痕模式忽略 */ }
    };
    window.addEventListener('scroll', savePosition, { passive: true });
    return () => window.removeEventListener('scroll', savePosition);
  }, []);

  // 未搜索时重新挂载，恢复上次的浏览位置（搜索态由快照里的 scrollY 负责）
  const searchedRef = useRef(searched);
  searchedRef.current = searched;
  useEffect(() => {
    if (searchedRef.current) return;
    let y = 0;
    try { y = Number(sessionStorage.getItem(HOME_SCROLL_KEY)) || 0; } catch { y = 0; }
    if (y <= 0) return;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' }));
    return () => cancelAnimationFrame(frame);
  }, []);
  /*
   * 卸载时中止进行中的搜索。
   *
   * 注意 aliveRef：StrictMode 在挂载后会「卸载 → 再挂载」模拟一次，卸载清理会
   * abort 掉此时已经发出的请求。把「是否还活着」单独记下来，并且只 abort
   * 真正在跑的那一次，避免挂载期间发起的搜索被这次假卸载误杀。
   */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  /*
   * 热搜榜：先用缓存立刻渲染，再后台刷新。
   * 缓存够新就不打接口——榜单一天内变化很小，没必要每次开 App 都请求。
   */
  useEffect(() => {
    let alive = true;
    (async () => {
      const cache = await loadTrendingCache();
      if (alive && cache?.data) setTrending(expandCache(cache.data));
      if (cache && isFresh(cache)) return;
      const fresh = await refreshTrending();
      if (alive) setTrending(fresh);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const activeCount = useMemo(() => sources.filter((s) => s.enabled).length, [sources]);
  const doneCount = statuses.filter((s) => s.state !== 'loading').length;
  const okCount = statuses.filter((s) => s.state === 'ok').length;

  const runSearch = useCallback(
    async (raw: string) => {
      const kw = raw.trim();
      if (!kw) {
        toast('请输入片名');
        return;
      }
      if (ready && !activeCount) {
        setKeyword(kw);
        setSearched(true);
        setSearching(false);
        setItems([]);
        setStatuses([]);
        return;
      }
      inputRef.current?.blur();
      const seq = ++seqRef.current;
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;

      setSearching(true);
      setSearched(true);
      setItems([]);
      setStatuses([]);
      setTotalMs(0);
      setFilters({ ...EMPTY_SEARCH_FILTERS });
      setRecent((prev) => {
        const next = pushRecent(prev, kw);
        void saveJSON(KEYS.recent, next);
        return next;
      });
      // 新搜索开始，旧快照立即作废，避免中途返回时闪出上一轮的结果
      setSearch(null);

      const res = await searchAll(kw, {
        sources,
        health,
        timeoutMs: settings.timeoutMs,
        signal: ctl.signal,
        onPartial: (partialItems, partialStatuses) => {
          if (seq !== seqRef.current || ctl.signal.aborted) return;
          setItems(partialItems);
          setStatuses(partialStatuses);
          putItems(partialItems);
        },
        onStatus: (st) => {
          if (seq !== seqRef.current) return;
          setStatuses((prev) => {
            const i = prev.findIndex((s) => s.key === st.key);
            if (i < 0) return [...prev, st];
            const next = [...prev];
            next[i] = st;
            return next;
          });
        },
      });

      if (seq !== seqRef.current) return;

      // 结果留在内存缓存里，详情页可直接复用，省掉一次网络往返
      putItems(res.items);
      setItems(res.items);
      setStatuses(res.statuses);
      setTotalMs(res.totalMs);
      setSearching(false);
      persistHealth();
      /*
       * 存快照：进详情页时 Home 会整体卸载，组件内 state 随之销毁；
       * 返回时组件重新挂载，用这份快照把搜索结果原样恢复出来。
       */
      setSearch({ keyword: kw, items: res.items, statuses: res.statuses, totalMs: res.totalMs });

      if (!res.items.length) {
        toast(`${activeCount} 个源都没搜到「${kw}」`);
      }
    },
    [sources, health, settings.timeoutMs, persistHealth, toast, activeCount, ready, setSearch],
  );

  /*
   * 退出搜索，回到首页发现页（热搜 / 继续观看 / 推荐 / 最近更新）。
   *
   * 之前搜过一次这个页面就再也回不去了：清空输入框只会把文字删掉，
   * 结果区依旧显示；安卓返回键更是直接退出 App。主流 App 的搜索页都有明确的
   * 「返回首页」出口，这里补上，并把搜索相关的临时状态一起复位。
   */
  const exitSearch = useCallback(() => {
    seqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setSearching(false);
    setSearched(false);
    setKeyword('');
    setItems([]);
    setStatuses([]);
    setTotalMs(0);
    setFilters({ ...EMPTY_SEARCH_FILTERS });
    setSort('default');
    setExpandedSeries(new Set());
    setSearch(null);
    inputRef.current?.blur();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [setSearch]);

  // 安卓返回键：搜索态先回到发现页，再按一次才轮到 App 退出
  useEffect(() => onBack(() => {
    if (!searched && !searching) return false;
    exitSearch();
    return true;
  }), [searched, searching, exitSearch]);

  // 再次点击底部「搜索」标签：主流 App 的约定是回到该页顶层
  useEffect(() => onTabReset((path) => {
    if (path === '/' && (searched || searching)) exitSearch();
  }), [searched, searching, exitSearch]);

  /*
   * 从详情页「重新搜索」或播放页「返回搜索」跳过来时，地址上带着 ?q=。
   * 之前读的是 window.location.search —— HashRouter 下它永远是空的，
   * 于是这些入口只会回到首页、并不会真的搜。改用路由的 location。
   */
  const deepLinkQuery = new URLSearchParams(location.search).get('q')?.trim() ?? '';

  useEffect(() => {
    if (!ready || !search || deepLinkQuery) return;
    setKeyword(search.keyword);
    setItems(search.items);
    setStatuses(search.statuses);
    setTotalMs(search.totalMs);
    setFilters(search.filters ?? { ...EMPTY_SEARCH_FILTERS });
    setSearched(true);
    const frame = requestAnimationFrame(() => window.scrollTo({ top: search.scrollY ?? 0, behavior: 'instant' }));
    return () => cancelAnimationFrame(frame);
  }, [ready, deepLinkQuery]);

  const deepLinkDone = useRef('');
  useEffect(() => {
    if (!ready || !deepLinkQuery || deepLinkDone.current === deepLinkQuery) return;
    deepLinkDone.current = deepLinkQuery;
    const q = deepLinkQuery;
    // 消费掉 ?q=，否则从详情页返回时会被当成新的一次深链再搜一遍
    nav('/', { replace: true });
    /*
     * 延后到微任务里再发起搜索。StrictMode 会在挂载后立刻模拟一次卸载，
     * 卸载清理会 abort 掉「当前进行中的请求」；同步发起的话，刚创建的
     * AbortController 会被这次假卸载掐断，表现为点了「重新搜索」却
     * 0 个源、几毫秒就结束。等这一轮清理跑完再发请求就不会被误杀。
     */
    queueMicrotask(() => {
      if (!aliveRef.current) return;
      // 深链优先：先清掉旧快照，避免闪一下上一次的搜索结果
      setSearch(null);
      setKeyword(q);
      void runSearch(q);
    });
  }, [ready, deepLinkQuery, runSearch, nav]);

  const changeFilters = (next: SearchFilters) => {
    setFilters(next);
    filtersRef.current = next;
    if (search && search.keyword === keyword) setSearch({ ...search, filters: next });
  };

  const openDetail = (item: AggregatedItem) => {
    if (searched) {
      setSearch({ keyword, items: itemsRef.current, statuses: statusesRef.current, totalMs, scrollY: scrollRef.current, savedAt: search?.savedAt, filters: filtersRef.current });
    }
    nav(`/detail/${encodeURIComponent(item.key)}?name=${encodeURIComponent(item.name)}`, {
      state: { item },
    });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">影视大全</h1>
          <div className="page-sub">
            {ready ? `${activeCount} 个资源源并发搜索 · 无广告` : '正在初始化…'}
          </div>
        </div>
      </div>

      <form
        className="search-row"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(keyword);
        }}
      >
        {/* 搜索结果页要有明确的「回首页」出口，否则搜一次就再也看不到热搜与推荐 */}
        {(searched || searching) && (
          <button type="button" className="search-back" onClick={exitSearch} aria-label="返回首页">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <div className="search-bar">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M21 21l-4.35-4.35M11 19a8 8 0 110-16 8 8 0 010 16z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            ref={inputRef}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="输入片名，如 庆余年"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {keyword && (
            <button
              type="button"
              className="search-clear"
              onClick={() => {
                // 结果页上清空输入框 = 结束这次搜索，回到首页；只删文字会留下一屏和输入框无关的结果
                if (searched || searching) {
                  exitSearch();
                  return;
                }
                setKeyword('');
                inputRef.current?.focus();
              }}
              aria-label={searched || searching ? '返回首页' : '清空'}
            >
              ×
            </button>
          )}
        </div>
        {searching ? (
          /* 搜索中最长可等 20 秒，必须给用户「停止」的出口，而不是只能干等或杀 App */
          <button
            className="btn-search"
            type="button"
            onClick={() => {
              seqRef.current += 1;
              abortRef.current?.abort();
              abortRef.current = null;
              setSearching(false);
              setSearched(false); // 回到初始态：热搜榜回来，进度框与「没有找到」不出现
              setStatuses([]);
              toast('已停止搜索');
            }}
          >
            停止
          </button>
        ) : (
          <button className="btn-search" type="submit" disabled={!ready}>
            搜索
          </button>
        )}
      </form>

      {!searched && Array.isArray(recent) && recent.length > 0 && (
        <div className="recent-row">
          <div className="chip-row">
            {recent.slice(0, 8).map((k) => (
              <button
                key={k}
                type="button"
                className="chip"
                onClick={() => {
                  setKeyword(k);
                  void runSearch(k);
                }}
              >
                {k}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="row-action"
            onClick={() => {
              setRecent([]);
              void saveJSON(KEYS.recent, []);
            }}
          >
            清除
          </button>
        </div>
      )}

      {!searched && (
        <>
          <div className="trend-box">
            <div className="trend-head">
              <span className="trend-title">实时热搜</span>
              <div className="trend-tabs">
                {TRENDING_TABS.map((t) => (
                  <button key={t.key} type="button" className={`trend-tab${trendTab === t.key ? ' active' : ''}`} onClick={() => setTrendTab(t.key)}>{t.label}</button>
                ))}
              </div>
            </div>
            <div className="trend-list">
              {trending[trendTab].map((e, i) => (
                <button key={e.title} type="button" className="trend-row" onClick={() => { setKeyword(e.title); void runSearch(e.title); }}>
                  <span className={`trend-rank${i < 3 ? ' top' : ''}`}>{i + 1}</span>
                  <span className="trend-name">{e.title}</span>
                  {e.score > 0 && <span className="trend-score">{e.score.toFixed(1)}</span>}
                </button>
              ))}
            </div>
          </div>

          {continueList.length > 0 && <section className="discover-section">
            <div className="section-head"><span className="section-title">继续观看</span><button className="section-more" onClick={() => nav('/favorites')}>全部记录</button></div>
            <div className="continue-row">{continueList.map((h) => {
              const progress = watchProgress(h);
              return <button className="continue-card" key={`${h.key}:${h.sourceKey}:${h.vodId}`} onClick={() => nav(`/detail/${encodeURIComponent(h.key)}?name=${encodeURIComponent(h.name)}`, { state: { meta: { sourceKey: h.sourceKey, vodId: h.vodId } } })}>
                <span className="continue-thumb">
                  {h.pic
                    ? <PosterImage name={h.name} urls={[h.pic]} />
                    : <span className="poster-fallback">{h.name.slice(0, 2)}</span>}
                  <span className="continue-badge">{h.episodeName || `第${h.episodeIndex + 1}集`}</span>
                  {progress.percent !== null && <span className="list-progress" aria-hidden="true"><span className="list-progress-fill" style={{ width: `${progress.percent}%` }} /></span>}
                </span>
                <span className="continue-title">{h.name}</span>
                <span className="continue-episode">{progress.duration > 0 ? `剩余 ${formatWatchTime(Math.max(0, progress.duration - progress.position))}` : progress.summary}</span>
              </button>;
            })}</div>
          </section>}

          {recommendItems.length > 0 && <section className="discover-section">
            <div className="section-head"><span className="section-title">为你推荐</span><span className="section-more">根据最近观看 · 仅本地</span></div>
            <div className="grid">{recommendItems.slice(0, 6).map((item) => <VodCard key={item.key} item={item} showSources={false} onClick={() => openDetail(item)} />)}</div>
          </section>}

          {latestItems.length > 0 && <section className="discover-section">
            <div className="section-head"><span className="section-title">最近更新</span><span className="section-more">来自优质源</span></div>
            <div className="grid">{latestItems.slice(0, 12).map((item) => <VodCard key={item.key} item={item} onClick={() => openDetail(item)} />)}</div>
          </section>}
        </>
      )}

      {searched && recent.length > 1 && !searching && (
        <div className="chip-row">
          {recent.slice(0, 6).map((k) => (
            <button
              key={k}
              type="button"
              className="chip"
              onClick={() => {
                setKeyword(k);
                void runSearch(k);
              }}
            >
              {k}
            </button>
          ))}
        </div>
      )}

      {(searching || searched) && (
        <div className="progress-box">
          <div className="progress-head">
            <span>
              {searching
                ? `已响应 ${doneCount}/${activeCount} 个源`
                : `${okCount} 个源有结果 · ${totalMs} ms`}
            </span>
            <span>
              {items.length} 部作品
            </span>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width: `${activeCount ? (doneCount / activeCount) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="section-head">
            <span className="section-title">搜索结果</span>
            <span className="section-more">多来源已合并</span>
          </div>
          <div className="sort-row">
            <span className="sort-label">排序</span>
            <div className="sort-seg" role="group" aria-label="结果排序">
              {SORT_OPTIONS.map((o) => (
                <button key={o.key} type="button" className={sort === o.key ? 'active' : ''}
                  aria-pressed={sort === o.key} onClick={() => setSort(o.key)}>{o.label}</button>
              ))}
            </div>
          </div>
          <SearchFilterBar value={filters} onChange={changeFilters} filtered={filteredItems.length} total={items.length} />
          <div className="search-tools">
            <label className="search-toggle">
              <input type="checkbox" checked={mainOnly} onChange={(e) => setMainOnly(e.target.checked)} />
              <span>仅显示正片{derivativeCount > 0 ? `（已收起 ${derivativeCount} 个解说/预告）` : ''}</span>
            </label>
            {!mainOnly && derivativeCount > 0 && <button type="button" className="row-action" onClick={() => setMainOnly(true)}>重新收起</button>}
          </div>
          {searchEntries.length > 0 ? (
            <div className="search-results-stack">
              {searchEntries.map((entry) => entry.kind === 'item' ? (
                <VodCard key={entry.key} item={entry.item} onClick={() => openDetail(entry.item)} />
              ) : (
                <div className="series-result" key={entry.key}>
                  <VodCard item={entry.items[0]} onClick={() => openDetail(entry.items[0])} />
                  <section className="series-card">
                    <button type="button" className="series-head" onClick={() => toggleSeries(entry.key)} aria-expanded={expandedSeries.has(entry.key)}>
                      <span className="series-title">其他季 / 版本</span>
                      <span className="series-count">{entry.items.length - 1} 部</span>
                      <span className="filter-chevron">⌄</span>
                    </button>
                    <div className={`series-body${expandedSeries.has(entry.key) ? ' open' : ''}`}>
                      <div className="grid">
                        {entry.items.slice(1).map((it) => <VodCard key={it.key} item={it} onClick={() => openDetail(it)} />)}
                      </div>
                    </div>
                  </section>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty filter-empty">
              <div>当前结果没有符合筛选条件的影片</div>
              <div className="hint">试试减少一个条件，或清除筛选查看全部 {items.length} 部作品。</div>
              <button className="btn" onClick={() => changeFilters({ ...EMPTY_SEARCH_FILTERS })}>清除筛选</button>
            </div>
          )}
        </>
      )}

      {searched && !searching && activeCount === 0 && (
        <div className="empty">
          <div className="empty-icon">⚙️</div>
          <div>尚未启用资源源</div>
          <div className="hint">启用至少一个资源源后才能搜索影片。</div>
          <button className="btn primary" style={{ maxWidth: 220 }} onClick={() => nav('/settings')}>前往设置启用资源源</button>
        </div>
      )}

      {searched && !searching && activeCount > 0 && items.length === 0 && (
        <div className="empty">
          <div className="empty-icon">🔍</div>
          <div>没有找到「{keyword}」</div>
          <div className="hint">换个片名试试，或在「设置」里检查资源源状态；部分源可能临时不可用，多源搜索会自动跳过。</div>
          <button className="btn" style={{ maxWidth: 200 }} onClick={exitSearch}>返回首页</button>
          {searchSuggestions(keyword, recent, trending[trendTab].map((e) => e.title)).length > 0 && (
            <div className="suggest-box">
              <div className="group-title">试试这些</div>
              <div className="chip-row">
                {searchSuggestions(keyword, recent, trending[trendTab].map((e) => e.title)).map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => { setKeyword(s); void runSearch(s); }}>{s}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!searched && (
        <div className="hint">
          搜索会同时向 {activeCount} 个影视资源站发起请求，自动合并同一部作品的多条线路。
          <br />
          全程无广告、无跳转、不收集任何个人信息。
        </div>
      )}
    </div>
  );
}
