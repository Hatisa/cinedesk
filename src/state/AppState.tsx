/**
 * 全局应用状态。
 *
 * 集中管理源列表、健康度、历史、收藏与设置，并把变更即时落盘。
 * 组件通过 useApp() 读取，避免层层透传。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_SETTINGS,
  HealthStore,
  KEYS,
  defaultSources,
  loadFavorites,
  loadHealth,
  loadHistory,
  loadJSON,
  loadSettings,
  loadSources,
  pushHistory,
  putItems,
  reconcileSources,
  saveJSON,
  toggleFavorite,
  type FavoriteEntry,
  type HealthRecord,
  type HistoryEntry,
  type Settings,
  type SourceConfig,
} from '../core';

import { normalizeSearchSnapshot, SEARCH_ITEM_MAX, type SearchSnapshot } from '../core/searchSnapshot';
export { normalizeSearchSnapshot, type SearchSnapshot } from '../core/searchSnapshot';

/** 从详情页返回或进程重建后恢复最近一次有效搜索。 */

interface AppState {
  ready: boolean;
  sources: SourceConfig[];
  health: HealthStore;
  history: HistoryEntry[];
  favorites: FavoriteEntry[];
  settings: Settings;
  /** 最近一次搜索的快照；null 表示当前没有可恢复的结果 */
  search: SearchSnapshot | null;
  setSearch: (s: SearchSnapshot | null) => void;
  setSources: (next: SourceConfig[]) => void;
  addSource: (src: Omit<SourceConfig, 'builtin'>) => void;
  updateSource: (key: string, patch: Partial<SourceConfig>) => void;
  removeSource: (key: string) => void;
  resetSources: () => void;
  setSettings: (patch: Partial<Settings>) => void;
  rememberPlay: (entry: HistoryEntry) => void;
  removeHistory: (entry: Pick<HistoryEntry, 'key' | 'sourceKey' | 'vodId'>) => void;
  clearHistory: () => void;
  restoreHistory: (entries: HistoryEntry[]) => void;
  restoreFavorites: (entries: FavoriteEntry[]) => void;
  restoreSource: (source: SourceConfig) => void;
  toggleFav: (entry: FavoriteEntry) => void;
  isFavorite: (entry: Pick<FavoriteEntry, 'key' | 'sourceKey' | 'vodId'>) => boolean;
  persistHealth: () => void;
  resetHealth: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [sources, setSourcesState] = useState<SourceConfig[]>(defaultSources);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [search, setSearchState] = useState<SearchSnapshot | null>(null);
  const healthRef = useRef(new HealthStore());

  // 启动时从本地存储恢复
  useEffect(() => {
    let alive = true;
    (async () => {
      const [srcs, health, hist, favs, cfg, storedSearch] = await Promise.all([
        loadSources(defaultSources()),
        loadHealth(),
        loadHistory(),
        loadFavorites(),
        loadSettings(),
        loadJSON<unknown>(KEYS.search, null),
      ]);
      if (!alive) return;
      healthRef.current = new HealthStore(health as Record<string, HealthRecord>);
      /*
       * 与当前内置清单对齐：设备里存的列表是安装当时的版本，内置清单改动
       * （如下架某个源）不会自动生效。reconcileSources 会保留用户选择的自定义源，
       * 同时让内置源跟随代码更新。
       */
      const merged = reconcileSources(srcs);
      setSourcesState(merged);
      void saveJSON(KEYS.sources, merged);
      setHistory(hist);
      setFavorites(favs);
      setSettingsState({ ...DEFAULT_SETTINGS, ...cfg });
      const snapshot = normalizeSearchSnapshot(storedSearch);
      if (snapshot) putItems(snapshot.items);
      setSearchState(snapshot);
      if (!snapshot && storedSearch) void saveJSON(KEYS.search, null);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persistHealth = useCallback(() => {
    void saveJSON(KEYS.health, healthRef.current.snapshot());
  }, []);

  const setSources = useCallback((next: SourceConfig[]) => {
    setSourcesState(next);
    void saveJSON(KEYS.sources, next);
  }, []);

  const addSource = useCallback(
    (src: Omit<SourceConfig, 'builtin'>) => {
      setSourcesState((prev) => {
        if (prev.some((s) => s.key === src.key)) return prev;
        const next = [...prev, { ...src, builtin: false }];
        void saveJSON(KEYS.sources, next);
        return next;
      });
    },
    [],
  );

  const updateSource = useCallback(
    (key: string, patch: Partial<SourceConfig>) => {
      setSourcesState((prev) => {
        const next = prev.map((s) => (s.key === key ? { ...s, ...patch } : s));
        void saveJSON(KEYS.sources, next);
        return next;
      });
    },
    [],
  );

  const removeSource = useCallback((key: string) => {
    setSourcesState((prev) => {
      const next = prev.filter((s) => s.key !== key || s.builtin);
      void saveJSON(KEYS.sources, next);
      return next;
    });
  }, []);

  const resetSources = useCallback(() => {
    const next = defaultSources();
    setSourcesState(next);
    void saveJSON(KEYS.sources, next);
  }, []);

  /*
   * 记录最近一次搜索的快照。
   *
   * Home 组件在路由切换（进详情页）时会卸载，仅靠组件内 useState 结果就丢了，
   * 返回时用户会看到搜索前的首页——这里把结果提到全局，返回时原样恢复。
   */
  const setSearch = useCallback((s: SearchSnapshot | null) => {
    setSearchState(s);
    void saveJSON(KEYS.search, s ? { ...s, savedAt: s.savedAt ?? Date.now(), items: s.items.slice(0, SEARCH_ITEM_MAX) } : null);
  }, []);

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      void saveJSON(KEYS.settings, next);
      return next;
    });
  }, []);

  const rememberPlay = useCallback(
    (entry: HistoryEntry) => {
      setHistory((prev) => {
        const next = pushHistory(prev, entry);
        void saveJSON(KEYS.history, next);
        return next;
      });
    },
    [],
  );

  const removeHistory = useCallback((entry: Pick<HistoryEntry, 'key' | 'sourceKey' | 'vodId'>) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h.key !== entry.key || h.sourceKey !== entry.sourceKey || h.vodId !== entry.vodId);
      void saveJSON(KEYS.history, next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    void saveJSON(KEYS.history, []);
  }, []);

  const restoreHistory = useCallback((entries: HistoryEntry[]) => {
    setHistory((prev) => {
      const next = [...prev, ...entries.filter((entry) => !prev.some((h) => h.key === entry.key && h.sourceKey === entry.sourceKey && h.vodId === entry.vodId))].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 300);
      void saveJSON(KEYS.history, next);
      return next;
    });
  }, []);

  const restoreFavorites = useCallback((entries: FavoriteEntry[]) => {
    setFavorites((prev) => {
      const next = [...entries.filter((entry) => !prev.some((f) => f.key === entry.key && f.sourceKey === entry.sourceKey && f.vodId === entry.vodId)), ...prev].slice(0, 300);
      void saveJSON(KEYS.favorites, next);
      return next;
    });
  }, []);

  const restoreSource = useCallback((source: SourceConfig) => {
    setSourcesState((prev) => {
      if (prev.some((s) => s.key === source.key)) return prev;
      const next = [...prev, source];
      void saveJSON(KEYS.sources, next);
      return next;
    });
  }, []);

  const toggleFav = useCallback((entry: FavoriteEntry) => {
    setFavorites((prev) => {
      const next = toggleFavorite(prev, entry);
      void saveJSON(KEYS.favorites, next);
      return next;
    });
  }, []);

  const isFavorite = useCallback((entry: Pick<FavoriteEntry, 'key' | 'sourceKey' | 'vodId'>) => favorites.some((f) => f.key === entry.key && f.sourceKey === entry.sourceKey && f.vodId === entry.vodId), [favorites]);

  const resetHealth = useCallback(() => {
    healthRef.current.reset();
    persistHealth();
  }, [persistHealth]);

  const value = useMemo<AppState>(
    () => ({
      ready,
      sources,
      health: healthRef.current,
      history,
      favorites,
      settings,
      search,
      setSearch,
      setSources,
      addSource,
      updateSource,
      removeSource,
      resetSources,
      setSettings,
      rememberPlay,
      removeHistory,
      clearHistory,
      restoreHistory,
      restoreFavorites,
      restoreSource,
      toggleFav,
      isFavorite,
      persistHealth,
      resetHealth,
    }),
    [
      ready, sources, history, favorites, settings, search, setSearch, setSources, addSource,
      updateSource, removeSource, resetSources, setSettings, rememberPlay, removeHistory,
      clearHistory, restoreHistory, restoreFavorites, restoreSource, toggleFav, isFavorite, persistHealth, resetHealth,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用');
  return ctx;
}
