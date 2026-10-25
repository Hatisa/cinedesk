import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cinedesk.app',
  appName: '影视大全',
  webDir: 'dist',
  // 让 WebView 的内置请求也放行 http:// 资源站，避免明文流量被拦截
  android: {
    allowMixedContent: true,
    /*
     * 刘海屏/状态栏避让。
     *
     * targetSdkVersion 是 35，Android 15 起系统会强制 edge-to-edge，WebView 铺满
     * 整屏，页面顶部的标题与按钮会被状态栏和挖孔压住。Capacitor 默认值 'disable'
     * 等于不做任何处理，所以这里显式打开。
     *
     * 用 'auto' 而不是 'force'：'auto' 只在 Android 15+ 真的 edge-to-edge 时才给
     * WebView 加 margin，Android 14 及以下系统本来就会自己留出状态栏空间，加 margin
     * 反而会多顶出一截。'auto' 也是 Capacitor 8 的默认值。
     */
    adjustMarginsForEdgeToEdge: 'auto',
  },
  // WebView 以 https://localhost 作为源，localStorage / Service Worker 行为更正常
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  plugins: {
    // 关键：拦截 fetch / XHR 走原生 OkHttp，从根本上绕过浏览器同源策略（CORS）
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
