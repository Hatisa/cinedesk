import { useState } from 'react';
import { shortRemarks } from '../core';
import type { AggregatedItem } from '../core';

interface Props {
  item: AggregatedItem;
  onClick: () => void;
  /** 显示「N个来源」徽标 */
  showSources?: boolean;
}

/** 影片卡片。图片来自各资源站，可能防盗链，加载失败时退化为文字占位 */
export default function VodCard({ item, onClick, showSources = true }: Props) {
  const [broken, setBroken] = useState(false);
  const remarks = shortRemarks(item.remarks);

  return (
    <button className="vod-card" onClick={onClick} type="button">
      <div className="vod-poster">
        {item.pic && !broken ? (
          <img
            src={item.pic}
            alt={item.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="poster-fallback">
            <span>{item.name.slice(0, 4)}</span>
          </div>
        )}
        {remarks && <span className="badge-remarks">{remarks}</span>}
        {item.score > 0 && <span className="badge-score">{item.score.toFixed(1)}</span>}
      </div>
      <div className="vod-meta">
        <div className="vod-name" title={item.name}>
          {item.name}
        </div>
        <div className="vod-sub">
          {item.year && <span>{item.year}</span>}
          {item.typeName && <span>{item.typeName.split(/[\/,]/)[0]}</span>}
        </div>
        {showSources && item.variants.length > 1 && (
          <div className="vod-sources">{item.variants.length} 个来源</div>
        )}
      </div>
    </button>
  );
}
