import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import VodCard from '../components/VodCard';
import SearchFilterBar from '../components/SearchFilterBar';
import { useToast } from '../components/Toast';
import {
  FALLBACK_TRENDING,
  KEYS,
  TRENDING_TABS,
  expandCache,
  isFresh,
  loadRecent,
  loadTrendingCache,
  putItems,
  pushRecent,
  refreshTrending,
  saveJSON,
  searchAll,
  EMPTY_SEARCH_FILTERS,
  filterSearchItems,
  type SearchFilters,
  type AggregatedItem,
  type SourceStatus,
  type TrendingMap,
  type TrendingTab,
} from '../core';
import { useApp } from '../state/AppState';

export default function Home() {
  const nav = useNavigate();
  const toast = useToast();
  const { sources, health, settings, persistHealth, ready, search, setSearch } = useApp();

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
  const filteredItems = useMemo(() => filterSearchItems(items, filters), [items, filters]);
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
    const savePosition = () => { scrollRef.current = window.scrollY; };
    window.addEventListener('scroll', savePosition, { passive: true });
    return () => window.removeEventListener('scroll', savePosition);
  }, []);
  useEffect(() => () => abortRef.current?.abort(), []);

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

  useEffect(() => {
    if (!ready || !search) return;
    setKeyword(search.keyword);
    setItems(search.items);
    setStatuses(search.statuses);
    setTotalMs(search.totalMs);
    setFilters(search.filters ?? { ...EMPTY_SEARCH_FILTERS });
    setSearched(true);
    const frame = requestAnimationFrame(() => window.scrollTo({ top: search.scrollY ?? 0, behavior: 'instant' }));
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  useEffect(() => {
    const query = new URLSearchParams(location.search).get('q');
    if (ready && query) {
      setKeyword(query);
      void runSearch(query);
    }
  }, [ready]);

  const changeFilters = (next: SearchFilters) => {
    setFilters(next);
    filtersRef.current = next;
    if (search && search.keyword === keyword) setSearch({ ...search, filters: next });
  };

  const openDetail = (item: AggregatedItem) => {
    setSearch({ keyword, items: itemsRef.current, statuses: statusesRef.current, totalMs, scrollY: scrollRef.current, savedAt: search?.savedAt, filters: filtersRef.current });
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
                setKeyword('');
                inputRef.current?.focus();
              }}
              aria-label="清空"
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

      {!searched && (
        <div className="trend-box">
          <div className="trend-head">
            <span className="trend-title">实时热搜</span>
            <div className="trend-tabs">
              {TRENDING_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`trend-tab${trendTab === t.key ? ' active' : ''}`}
                  onClick={() => setTrendTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="trend-list">
            {trending[trendTab].map((e, i) => (
              <button
                key={e.title}
                type="button"
                className="trend-row"
                onClick={() => {
                  setKeyword(e.title);
                  void runSearch(e.title);
                }}
              >
                <span className={`trend-rank${i < 3 ? ' top' : ''}`}>{i + 1}</span>
                <span className="trend-name">{e.title}</span>
                {e.score > 0 && <span className="trend-score">{e.score.toFixed(1)}</span>}
              </button>
            ))}
          </div>
        </div>
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
          <SearchFilterBar value={filters} onChange={changeFilters} filtered={filteredItems.length} total={items.length} />
          {filteredItems.length > 0 ? (
            <div className="grid search-result-grid">
              {filteredItems.map((it) => (
                <VodCard key={it.key} item={it} onClick={() => openDetail(it)} />
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
          <div className="hint">
            换个片名试试，或在「设置」里检查资源源状态
            <br />
            部分源可能临时不可用，多源搜索会自动跳过
          </div>
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
