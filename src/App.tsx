import { useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import BottomNav from './components/BottomNav';
import Detail from './pages/Detail';
import Favorites from './pages/Favorites';
import Home from './pages/Home';
import Play from './pages/Play';
import Settings from './pages/Settings';
import { addBackListener, consumeBack, exitApp, isNative } from './core';

/** 详情页与播放页需要沉浸式全屏，不显示底部导航 */
const IMMERSIVE = ['/detail/', '/play/'];

export default function App() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const immersive = IMMERSIVE.some((p) => pathname.startsWith(p));

  /*
   * 安卓返回键接管。
   *
   * 默认行为是直接退出 App——这是安卓 WebView 最容易被诟病的一点：
   * 用户从详情页点到播放页，按一次返回键整个 App 就没了。
   *
   * 这里改成逐级返回：先让页面自己处理（退出全屏、收起展开的面板），
   * 再按路由历史回退；只有已经在首页、确实没有可回退的页面时才退出。
   * 这样「返回」始终符合用户的心理预期。
   */
  useEffect(() => {
    if (!isNative()) return;
    return addBackListener(() => {
      // 1) 页面级拦截：例如播放页正在全屏，返回键应先退出全屏
      if (consumeBack()) return;

      /*
       * 2) 沿路由历史回退。react-router 在 history.state 里维护 idx，
       *    idx > 0 表示前面还有页面可回退。
       */
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
      if (idx > 0) {
        nav(-1);
        return;
      }

      // 3) 已在首页，没有可回退的页面，此时才交给系统退出
      exitApp();
    });
  }, [nav]);

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/detail/:key" element={<Detail />} />
        <Route path="/play/:key" element={<Play />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Home />} />
      </Routes>
      {!immersive && <BottomNav />}
    </div>
  );
}
