import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cinedesk.app',
  appName: '影视大全',
  webDir: 'dist',
  // 让 WebView 的内置请求也放行 http:// 资源站，避免明文流量被拦截
  android: {
    allowMixedContent: true,
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
