import { Route, Routes, useLocation } from 'react-router-dom';
import BottomNav from './components/BottomNav';
import Detail from './pages/Detail';
import Favorites from './pages/Favorites';
import Home from './pages/Home';
import Play from './pages/Play';
import Settings from './pages/Settings';

/** 详情页与播放页需要沉浸式全屏，不显示底部导航 */
const IMMERSIVE = ['/detail/', '/play/'];

export default function App() {
  const { pathname } = useLocation();
  const immersive = IMMERSIVE.some((p) => pathname.startsWith(p));

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
