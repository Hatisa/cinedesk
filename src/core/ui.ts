/**
 * 页面间的小工具：返回兜底与底部导航的「再点一次回到顶层」。
 *
 * 这两件事都不涉及网络与原生能力，但散落在各页面里容易写歪，
 * 统一放这里，页面只负责调用。
 */

/** 与 react-router 的 useNavigate 兼容：既能接受路径，也能接受历史步数 */
type Navigate = {
  (delta: number): void;
  (to: string, options?: { replace?: boolean }): void;
};

/**
 * 返回上一页；没有历史可退时回到 fallback。
 *
 * 直接用 nav(-1) 有个坑：从分享链接 / 应用被系统恢复时，详情页可能是第一个
 * 历史记录，此时 nav(-1) 会退到空白页（原生里直接闪回桌面）。主流 App 的做法是
 * 退到首页，这里照做。
 */
export function goBackOr(navigate: Navigate, fallback = '/'): void {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) navigate(-1);
  else navigate(fallback, { replace: true });
}

/**
 * 底部导航「再次点击当前标签」事件。
 *
 * 主流 App 的约定：点当前 tab 不动路由，而是回到该页顶层（首页=退出搜索、
 * 列表=回到顶部）。用自定义事件而不是往状态树里塞字段，页面各自订阅即可。
 */
export const TAB_RESET_EVENT = 'cinedesk:tab-reset';

export function emitTabReset(path: string): void {
  window.dispatchEvent(new CustomEvent<string>(TAB_RESET_EVENT, { detail: path }));
}

export function onTabReset(handler: (path: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener(TAB_RESET_EVENT, listener);
  return () => window.removeEventListener(TAB_RESET_EVENT, listener);
}
