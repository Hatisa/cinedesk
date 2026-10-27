/**
 * 原生能力封装：安卓返回键与屏幕方向。
 *
 * 这些能力只在 Capacitor 原生容器（APK）里存在，浏览器调试时是空操作，
 * 所以每个入口都先判断平台 —— 开发时不会因为插件缺失而报错。
 */
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';

/** 是否运行在 APK 里（浏览器调试时为 false） */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/*
 * 返回键拦截器。
 *
 * 页面可以注册「按返回键时该做什么」（例如播放页先退出全屏、列表页先收起
 * 展开的面板）。返回键本身由 App 统一接管，但会优先询问这些拦截器，
 * 避免每个页面各自监听 backButton 导致只有一个生效。
 */
type BackHandler = () => boolean;

const backHandlers: BackHandler[] = [];

/** 注册返回键拦截器，返回注销函数。返回 true 表示本次返回键已被消费 */
export function onBack(handler: BackHandler): () => void {
  backHandlers.push(handler);
  return () => {
    const i = backHandlers.indexOf(handler);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}

/** 依次询问拦截器（后注册的先问），任一返回 true 即表示已消费 */
export function consumeBack(): boolean {
  for (let i = backHandlers.length - 1; i >= 0; i -= 1) {
    if (backHandlers[i]()) return true;
  }
  return false;
}

/** 监听安卓物理返回键 / 手势返回 */
export function addBackListener(cb: () => void): () => void {
  if (!isNative()) return () => undefined;
  const handle = App.addListener('backButton', cb);
  return () => {
    void handle.then((h) => h.remove()).catch(() => undefined);
  };
}

/** 退出 App（仅原生平台有效） */
export function exitApp(): void {
  if (!isNative()) return;
  void App.exitApp().catch(() => undefined);
}

/**
 * 锁定 / 解除横屏。
 *
 * 全屏播放时锁横屏；退出全屏锁回竖屏（而不是 unlock 跟随系统），
 * 因为本 App 的页面都是竖屏布局 —— 内容区 max-width 780px 居中，
 * 若停留在横屏，列表页会错位、播放页下方的选集区会被压扁。
 * 部分设备开了「方向锁定」会拒绝锁屏请求，此时静默忽略即可，不影响播放。
 */
export async function setLandscape(on: boolean): Promise<void> {
  if (!isNative()) return;
  try {
    await ScreenOrientation.lock({ orientation: on ? 'landscape' : 'portrait' });
  } catch {
    // 设备方向被系统锁定时会失败，忽略
  }
}

/** 安卓 WebView 的 video 全屏走私有 API，标准类型里没有，这里补齐 */
type FullscreenVideo = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitExitFullscreen?: () => void;
};

/**
 * 当前是否处于全屏播放。
 *
 * 标准 Fullscreen API 与 WebView 的私有属性都要看：安卓 WebView 里
 * video 全屏走的是后者，只检查 document.fullscreenElement 会漏判。
 */
export function isFullscreen(): boolean {
  if (document.fullscreenElement) return true;
  const v = document.querySelector('video') as FullscreenVideo | null;
  return Boolean(v?.webkitDisplayingFullscreen);
}

/** 退出全屏（若当前处于全屏） */
export function exitFullscreen(): void {
  const v = document.querySelector('video') as FullscreenVideo | null;
  if (v?.webkitDisplayingFullscreen && typeof v.webkitExitFullscreen === 'function') {
    v.webkitExitFullscreen();
    return;
  }
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
  }
}
