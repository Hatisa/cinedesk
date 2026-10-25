import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import https from 'node:https';

/**
 * 开发环境转发中间件。
 *
 * 打包成 APK 后请求走 CapacitorHttp（原生 OkHttp），不受同源策略约束；
 * 但在桌面浏览器里调试时会被 CORS 拦住。这个中间件在 dev server 上
 * 提供一个 /__proxy?url=... 入口，仅供本地联调，不会进入生产构建。
 */
function devProxy(): Plugin {
  return {
    name: 'cinedesk-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__proxy', (req, res) => {
        const target = new URL(req.url || '', 'http://localhost').searchParams.get('url');
        if (!target) {
          res.statusCode = 400;
          res.end('missing url');
          return;
        }
        let parsed: URL;
        try {
          parsed = new URL(target);
        } catch {
          res.statusCode = 400;
          res.end('bad url');
          return;
        }
        const client = parsed.protocol === 'https:' ? https : http;
        const upstream = client.request(
          {
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
              Accept: 'application/json, text/plain, */*',
              Referer: `${parsed.origin}/`,
            },
            timeout: 15000,
          },
          (up) => {
            res.statusCode = up.statusCode || 502;
            res.setHeader('Content-Type', up.headers['content-type'] || 'text/plain; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*');
            up.pipe(res);
          },
        );
        upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
        upstream.on('error', (e) => {
          res.statusCode = 502;
          res.end(String(e.message || e));
        });
        upstream.end();
      });
    },
  };
}

export default defineConfig({
  // 相对路径：Capacitor 从本地加载资源，必须用相对路径
  base: './',
  plugins: [react(), devProxy()],
  build: {
    outDir: 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: { hls: ['hls.js'] },
      },
    },
  },
  server: { host: true, port: 5173 },
});
