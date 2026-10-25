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
  loadSettings,
  loadSources,
  pushHistory,
  reconcileSources,
  saveJSON,
  toggleFavorite,
  type FavoriteEntry,
  type HealthRecord,
  type HistoryEntry,
  type Settings,
  type SourceConfig,
} from '../core';

interface AppState {
  ready: boolean;
  sources: SourceConfig[];
  health: HealthStore;
  history: HistoryEntry[];
  favorites: FavoriteEntry[];
  settings: Settings;
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
  const healthRef = useRef(new HealthStore());

  // 启动时从本地存储恢复
  useEffect(() => {
    let alive = true;
    (async () => {
      const [srcs, health, hist, favs, cfg] = await Promise.all([
        loadSources(defaultSources()),
        loadHealth(),
        loadHistory(),
        loadFavorites(),
        loadSettings(),
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
      persistHealth,
      resetHealth,
    }),
    [
      ready, sources, history, favorites, settings, setSources, addSource, updateSource,
      removeSource, resetSources, setSettings, rememberPlay, removeHistory, clearHistory,
      toggleFav, isFavorite, persistHealth, resetHealth,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用');
  return ctx;
}
