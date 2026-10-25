import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppState';

export default function Favorites() {
  const nav = useNavigate();
  const { favorites, history, toggleFav, removeHistory, clearHistory } = useApp();
  const [tab, setTab] = useState<'fav' | 'history'>('fav');

  const toDetail = (key: string, name: string, item?: unknown) => {
    nav(`/detail/${encodeURIComponent(key)}?name=${encodeURIComponent(name)}`, {
      state: item ? { item } : undefined,
    });
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">我的</h1>
      </div>

      <div className="line-tabs" style={{ marginBottom: 14 }}>
        <button className={`line-tab${tab === 'fav' ? ' active' : ''}`} onClick={() => setTab('fav')}>
          收藏 {favorites.length ? `(${favorites.length})` : ''}
        </button>
        <button
          className={`line-tab${tab === 'history' ? ' active' : ''}`}
          onClick={() => setTab('history')}
        >
          观看记录 {history.length ? `(${history.length})` : ''}
        </button>
      </div>

      {tab === 'fav' && (
        <>
          {favorites.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">⭐</div>
              <div>还没有收藏</div>
              <div className="hint">在影片详情页点「收藏」，方便下次直接找到</div>
            </div>
          ) : (
            <div className="list">
              {favorites.map((f) => (
                <div className="list-row" key={f.key}>
                  {f.pic ? (
                    <img
                      className="list-thumb"
                      src={f.pic}
                      alt={f.name}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                      }}
                    />
                  ) : (
                    <div className="list-thumb" />
                  )}
                  <button
                    className="list-body"
                    onClick={() => toDetail(f.key, f.name)}
                    style={{ textAlign: 'left' }}
                  >
                    <div className="list-title">{f.name}</div>
                    <div className="list-desc">
                      {[f.year, f.remarks].filter(Boolean).join(' · ') || f.sourceName}
                    </div>
                  </button>
                  <button className="row-action" onClick={() => toggleFav(f)}>
                    移除
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <>
          {history.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">🕘</div>
              <div>还没有观看记录</div>
              <div className="hint">看过的影片会自动记录进度，下次接着看</div>
            </div>
          ) : (
            <>
              <div className="section-head">
                <span className="section-title">最近观看</span>
                <button className="section-more" onClick={clearHistory}>
                  清空
                </button>
              </div>
              <div className="list">
                {history.map((h) => {
                  const pct =
                    h.duration > 0 ? Math.min(100, Math.round((h.position / h.duration) * 100)) : 0;
                  return (
                    <div className="list-row" key={h.key}>
                      {h.pic ? (
                        <img
                          className="list-thumb"
                          src={h.pic}
                          alt={h.name}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                          }}
                        />
                      ) : (
                        <div className="list-thumb" />
                      )}
                      <button
                        className="list-body"
                        onClick={() => toDetail(h.key, h.name)}
                        style={{ textAlign: 'left' }}
                      >
                        <div className="list-title">{h.name}</div>
                        <div className="list-desc">
                          看到 {h.episodeName || `第${h.episodeIndex + 1}集`}
                          {pct > 0 ? ` · ${pct}%` : ''} · {h.sourceName}
                        </div>
                      </button>
                      <button className="row-action" onClick={() => removeHistory(h.key)}>
                        删除
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
