/**
 * 离线缓存页。
 *
 * 两块内容：
 *   1) 正在下载的任务（含等待队列），可取消、可重试；
 *   2) 已缓存的内容，按剧分组展开。
 *
 * 缓存的目录结构（应用私有目录，卸载自动清理）：
 *
 *   cinedesk/庆余年_第一季/001_第01集/seg-000001.ts …
 *                        /002_第02集/…
 *
 * 剧一个目录、集号零填充子目录，同一部剧的集紧跟剧目录、
 * 不同剧的目录互不相干，文件管理器里也是这个顺序。
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { epDir, fmtBytes, fmtSpeed, removeDir, totalBytes, totalEpisodes } from '../core';
import { useApp } from '../state/AppState';
import { useDownload } from '../state/downloadManager';

export default function Downloads() {
  const nav = useNavigate();
  const { offline, dropOffline, dropOfflineAll } = useApp();
  const { tasks, cancel, retry, clearFinished } = useDownload();
  /** 展开的剧（看它的集列表）；同时只展开一部，列表长时不会互相挤 */
  const [openKey, setOpenKey] = useState<string | null>(null);

  const active = tasks.filter((t) => t.status === 'waiting' || t.status === 'running');
  const finished = tasks.filter(
    (t) => t.status === 'failed' || t.status === 'cancelled' || t.status === 'done',
  );

  const deleteEpisode = async (showDir: string, ep: { epIndex: number; epName: string }, key: string) => {
    /*
     * 先删文件再删索引。
     * 反过来的话，删文件失败就留下一个「索引里没有、磁盘上还在」的孤儿目录，
     * 用户在设置里看不到它，却一直占着空间。
     */
    await removeDir(`${showDir}/${epDir(ep.epIndex, ep.epName)}`);
    dropOffline(key, ep.epIndex);
  };

  const deleteShow = async (showDir: string, key: string) => {
    await removeDir(showDir);
    dropOfflineAll(key);
    setOpenKey((k) => (k === key ? null : k));
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">离线缓存</h1>
        {offline.length > 0 && (
          <div className="page-sub">
            共 {totalEpisodes(offline)} 集 · {fmtBytes(totalBytes(offline))}
          </div>
        )}
      </div>

      {/* ---------- 正在下载 ---------- */}
      {/*
       * 只要有任务就显示标题，否则任务列表会「无标题地」浮在页面上，
       * 用户不知道那一块是什么。清除记录只在有已结束任务时才有意义。
       */}
      {(active.length > 0 || finished.length > 0) && (
        <div className="section-head">
          <span className="section-title">下载任务</span>
          {finished.length > 0 && (
            <button className="section-more" onClick={clearFinished}>
              清除记录
            </button>
          )}
        </div>
      )}
      {(active.length > 0 || finished.length > 0) && (
        <div className="list">
          {[...active, ...finished].map((t) => {
            /*
             * 进度百分比、体积、速度三者都给出来。
             * 只显示「已下 N 片」时，几百片的任务看起来几乎不动，用户
             * 会以为卡死了；速度能立刻回答「到底有没有在走」。
             */
            const pct =
              t.total > 0
                ? Math.min(100, Math.round((t.done / t.total) * 100))
                : t.status === 'done'
                  ? 100
                  : 0;
            const speed = fmtSpeed(t.speed);
            return (
              <div className="list-row" key={t.id}>
                <div className="list-thumb" />
                <div className="list-body">
                  <div className="list-title">{t.payload.name}</div>
                  <div className="list-desc">
                    {t.payload.epName}
                    {t.status === 'waiting' && ' · 排队等待中'}
                    {t.status === 'running' &&
                      (t.total > 0
                        ? ` · ${pct}%（${t.done}/${t.total} 分片） · ${fmtBytes(t.bytes)}${
                            speed ? ` · ${speed}` : ''
                          }`
                        : ' · 正在解析分片列表…')}
                    {t.status === 'done' && ` · 已完成 ${fmtBytes(t.bytes)}`}
                    {t.status === 'cancelled' && ' · 已取消'}
                    {t.status === 'failed' && ` · 失败：${t.error ?? '未知错误'}`}
                  </div>
                  {(t.status === 'running' || t.status === 'waiting') && (
                    <div className="list-progress">
                      <div className="list-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
                {(t.status === 'waiting' || t.status === 'running') && (
                  <button className="row-action" onClick={() => cancel(t.id)}>
                    取消
                  </button>
                )}
                {(t.status === 'failed' || t.status === 'cancelled') && (
                  <button className="row-action" onClick={() => retry(t.id)}>
                    重试
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- 已缓存 ---------- */}
      {/*
       * 空态的条件必须同时看任务：只看 offline 的话，正在下载第一集时
       * 上面是任务进度、下面写着「还没有缓存任何内容」，两句自相矛盾。
       */}
      {offline.length === 0 && tasks.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">⬇️</div>
          <div>还没有缓存任何内容</div>
          <div className="hint">在影片详情页点「缓存」，提前下好，没网也能看</div>
        </div>
      ) : offline.length === 0 ? null : (
        <>
          <div className="section-head">
            <span className="section-title">已缓存</span>
          </div>
          <div className="list">
            {offline.map((s) => {
              const bytes = s.episodes.reduce((a, e) => a + (e.bytes || 0), 0);
              const open = openKey === s.key;
              return (
                <div key={s.key} className="offline-show">
                  <div className="list-row">
                    {s.pic ? (
                      <img
                        className="list-thumb"
                        src={s.pic}
                        alt={s.name}
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
                      onClick={() => setOpenKey(open ? null : s.key)}
                      style={{ textAlign: 'left' }}
                    >
                      <div className="list-title">{s.name}</div>
                      <div className="list-desc">
                        {[s.year, s.typeName].filter(Boolean).join(' · ')}
                        {s.year || s.typeName ? ' · ' : ''}
                        已缓存 {s.episodes.length} 集 · {fmtBytes(bytes)}
                      </div>
                    </button>
                    <button className="row-action" onClick={() => void deleteShow(s.showDir, s.key)}>
                      删除
                    </button>
                  </div>

                  {open && (
                    <div className="offline-eps">
                      {s.episodes.map((e) => (
                        <div className="list-row" key={e.epIndex}>
                          <div className="list-thumb" />
                          <button
                            className="list-body"
                            style={{ textAlign: 'left' }}
                            onClick={() =>
                              nav(
                                `/play/${encodeURIComponent(s.key)}?name=${encodeURIComponent(s.name)}&ep=${e.epIndex}`,
                              )
                            }
                          >
                            <div className="list-title">{e.epName}</div>
                            <div className="list-desc">
                              {fmtBytes(e.bytes)}
                              {e.duration > 0 ? ` · ${Math.round(e.duration / 60)} 分钟` : ''}
                              {` · ${e.quality === 'high' ? '高清' : e.quality === 'low' ? '流畅' : '标清'}`}
                            </div>
                          </button>
                          <button
                            className="row-action"
                            onClick={() => void deleteEpisode(s.showDir, e, s.key)}
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
