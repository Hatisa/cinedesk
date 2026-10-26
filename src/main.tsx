import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './components/Toast';
import { AppProvider } from './state/AppState';
import { DownloadProvider } from './state/downloadManager';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 未找到');

// HashRouter：Capacitor 从本地加载页面，没有服务端路由，hash 路由最稳
createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <AppProvider>
        <ToastProvider>
          {/*
            DownloadProvider 必须在 AppProvider 之内：它要读写离线索引
            （useApp），并依赖其状态判断某集是否已缓存。
          */}
          <DownloadProvider>
            <App />
          </DownloadProvider>
        </ToastProvider>
      </AppProvider>
    </HashRouter>
  </StrictMode>,
);
