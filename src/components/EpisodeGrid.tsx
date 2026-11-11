import type { ReactNode } from 'react';
import { useEpisodeColumns } from './useEpisodeColumns';

/**
 * 选集网格：列数按标题实测宽度自适应（见 core/episodeGrid.ts），
 * 短标题仍保持每行 5 集，长标题自动减少每行集数，按钮等宽对齐。
 */
export default function EpisodeGrid({ names, children }: { names: string[]; children: ReactNode }) {
  const grid = useEpisodeColumns(names);
  return (
    <div className="ep-grid" ref={grid.ref} style={grid.style}>
      {children}
    </div>
  );
}
