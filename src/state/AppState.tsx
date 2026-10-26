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
  type AggregatedItem,
  DEFAULT_SETTINGS,
  HealthStore,
  KEYS,
  defaultSources,
  loadFavorites,
  loadHealth,
  loadHistory,
  loadSettings,
  loadSources,
  pushHistory,
  reconcileSources,
  saveJSON,
  toggleFavorite,
  loadOffline,
  saveOffline,
  removeEpisode as dropOfflineEpisode,
  removeShow as dropOfflineShow,
  upsertEpisode as addOfflineEpisode,
  findEpisode as findOfflineEpisode,
  type OfflineEpisode,
  type OfflineShow,
  type FavoriteEntry,
  type HealthRecord,
  type HistoryEntry,
  type Settings,
  type SourceConfig,
  type SourceStatus,
} from '../core';

/** 一次搜索的完整快照：从详情页返回首页时用它恢复搜索结果 */
export interface SearchSnapshot {
  keyword: string;
  items: AggregatedItem[];
  statuses: SourceStatus[];
  totalMs: number;
}

interface AppState {
  ready: boolean;
  sources: SourceConfig[];
  health: HealthStore;
  history: HistoryEntry[];
  favorites: FavoriteEntry[];
  settings: Settings;
  /** 离线缓存索引（哪部剧缓存了哪几集） */
  offline: OfflineShow[];
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
  removeHistory: (key: string) => void;
  clearHistory: () => void;
  toggleFav: (entry: FavoriteEntry) => void;
  isFavorite: (key: string) => boolean;
  /** 写入/覆盖一集的缓存记录 */
  saveOfflineEpisode: (
    show: { key: string; name: string; pic: string; year: string; typeName: string; showDir?: string },
    ep: OfflineEpisode,
  ) => void;
  /** 删除一集的缓存记录（分片文件由调用方清理） */
  dropOffline: (key: string, epIndex: number) => void;
  /** 删除整部剧的缓存记录 */
  dropOfflineAll: (key: string) => void;
  /** 查该集是否已缓存；播放页据此直接走本地，避免无网时先等在线超时 */
  cachedEpisode: (key: string, epIndex: number) => OfflineEpisode | undefined;
  /** 在设置页改为立即生效 */
  setOffline: (next: OfflineShow[]) => void;
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
  const [offline, setOfflineState] = useState<OfflineShow[]>([]);
  const [search, setSearchState] = useState<SearchSnapshot | null>(null);
  const healthRef = useRef(new HealthStore());

  // 启动时从本地存储恢复
  useEffect(() => {
    let alive = true;
    (async () => {
      const [srcs, health, hist, favs, cfg, off] = await Promise.all([
        loadSources(defaultSources()),
        loadHealth(),
        loadHistory(),
        loadFavorites(),
        loadSettings(),
        loadOffline(),
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
      setOfflineState(off);
      setSettingsState({ ...DEFAULT_SETTINGS, ...cfg });
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

  const removeHistory = useCallback((key: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h.key !== key);
      void saveJSON(KEYS.history, next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    void saveJSON(KEYS.history, []);
  }, []);

  const toggleFav = useCallback((entry: FavoriteEntry) => {
    setFavorites((prev) => {
      const next = toggleFavorite(prev, entry);
      void saveJSON(KEYS.favorites, next);
      return next;
    });
  }, []);

  const isFavorite = useCallback((key: string) => favorites.some((f) => f.key === key), [favorites]);

  /*
   * 离线索引的写入统一走「先算新值、再落盘、再更新 state」。
   * 直接读 offline 做闭包计算会拿到陈旧值：下载是异步的，一次批量缓存
   * 多集时会连续调用，前后两次基于同一个旧数组，后写的会把先写的顶掉。
   */
  const setOffline = useCallback((next: OfflineShow[]) => {
    setOfflineState(next);
    void saveOffline(next);
  }, []);

  const saveOfflineEpisode = useCallback<AppState['saveOfflineEpisode']>((show, ep) => {
    setOfflineState((prev) => {
      const next = addOfflineEpisode(prev, show, ep);
      void saveOffline(next);
      return next;
    });
  }, []);

  const dropOffline = useCallback((key: string, epIndex: number) => {
    setOfflineState((prev) => {
      const next = dropOfflineEpisode(prev, key, epIndex);
      void saveOffline(next);
      return next;
    });
  }, []);

  const dropOfflineAll = useCallback((key: string) => {
    setOfflineState((prev) => {
      const next = dropOfflineShow(prev, key);
      void saveOffline(next);
      return next;
    });
  }, []);

  /** 读当前索引即可：offline 是 state，随写入同步更新 */
  const cachedEpisode = useCallback(
    (key: string, epIndex: number) => findOfflineEpisode(offline, key, epIndex),
    [offline],
  );

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
      offline,
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
      toggleFav,
      isFavorite,
      saveOfflineEpisode,
      dropOffline,
      dropOfflineAll,
      cachedEpisode,
      setOffline,
      persistHealth,
      resetHealth,
    }),
    [
      ready, sources, history, favorites, settings, offline, search, setSearch, setSources, addSource,
      updateSource, removeSource, resetSources, setSettings, rememberPlay, removeHistory,
      clearHistory, toggleFav, isFavorite, saveOfflineEpisode, dropOffline, dropOfflineAll,
      cachedEpisode, setOffline, persistHealth, resetHealth,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用');
  return ctx;
}
