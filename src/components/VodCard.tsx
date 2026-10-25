import { useState } from 'react';
import { isShortDramaClass, shortRemarks } from '../core';
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

  // 分类只展示主分类（vod_class 常是「剧情,古装,内地剧」这样的多值串）
  const mainClass = item.typeName.split(/[\/,]/)[0] || '';
  // 主分类本身就是短剧分类时，标签会与分类名重复（「短剧 短剧」），此时不再附标签
  const showShortTag = item.shortDrama && !isShortDramaClass(mainClass);

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
          {mainClass && <span>{mainClass}</span>}
          {/* 短剧统一沉底，标出来让用户知道为什么它排在后面 */}
          {showShortTag && <span className="tag-short">短剧</span>}
        </div>
        {showSources && item.variants.length > 1 && (
          <div className="vod-sources">{item.variants.length} 个来源</div>
        )}
      </div>
    </button>
  );
}
