import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import VodCard from '../components/VodCard';
import { useToast } from '../components/Toast';
import {
  FALLBACK_TRENDING,
  TRENDING_TABS,
  expandCache,
  isFresh,
  loadTrendingCache,
  putItems,
  refreshTrending,
  searchAll,
  type AggregatedItem,
  type SourceStatus,
  type TrendingMap,
  type TrendingTab,
} from '../core';
import { useApp } from '../state/AppState';

export default function Home() {
  const nav = useNavigate();
  const toast = useToast();
  const { sources, health, settings, persistHealth, ready } = useApp();

  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<AggregatedItem[]>([]);
  const [statuses, setStatuses] = useState<SourceStatus[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [totalMs, setTotalMs] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [trending, setTrending] = useState<TrendingMap>(FALLBACK_TRENDING);
  const [trendTab, setTrendTab] = useState<TrendingTab>('movie');
  const inputRef = useRef<HTMLInputElement>(null);
  // 每次搜索递增，防止旧搜索的结果覆盖新搜索
  const seqRef = useRef(0);

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
      inputRef.current?.blur();
      const seq = ++seqRef.current;

      setSearching(true);
      setSearched(true);
      setItems([]);
      setStatuses([]);
      setTotalMs(0);
      setRecent((prev) => [kw, ...prev.filter((k) => k !== kw)].slice(0, 8));

      const res = await searchAll(kw, {
        sources,
        health,
        timeoutMs: settings.timeoutMs,
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

      if (!res.items.length) {
        toast(`${activeCount} 个源都没搜到「${kw}」`);
      }
    },
    [sources, health, settings.timeoutMs, persistHealth, toast, activeCount],
  );

  const openDetail = (item: AggregatedItem) => {
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
        <button className="btn-search" type="submit" disabled={searching || !ready}>
          {searching ? '搜索中' : '搜索'}
        </button>
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
          <div className="grid">
            {items.map((it) => (
              <VodCard key={it.key} item={it} onClick={() => openDetail(it)} />
            ))}
          </div>
        </>
      )}

      {searched && !searching && items.length === 0 && (
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
