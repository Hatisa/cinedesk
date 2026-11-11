import { useLayoutEffect, useRef, useState } from 'react';
import { episodeColumnCount } from '../core/episodeGrid';

let measureCanvas: HTMLCanvasElement | null = null;

function measureContext(): CanvasRenderingContext2D | null {
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  return measureCanvas.getContext('2d');
}

/**
 * 按剧集名的实际渲染宽度算出每行列数。
 *
 * 文本宽度用 canvas 量（和按钮同一套 font），比按字符数估算准：
 * 「第01集」和「第1期上中纯享版」在同样的字数下宽度差一倍。
 * 网格折叠（clientWidth 为 0）时返回 0，由 CSS 的 auto-fill 兜底。
 */
export function useEpisodeColumns(names: string[]) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(0);
  const signature = names.join('\u0001');

  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    let frame = 0;

    const measure = () => {
      const width = grid.clientWidth;
      const sample = grid.querySelector<HTMLElement>('.ep-btn');
      const context = measureContext();
      if (!width || !sample || !context) {
        setColumns(0);
        return;
      }
      const style = getComputedStyle(sample);
      context.font = `${style.fontSize} ${style.fontFamily}`;
      const widths = signature.split('\u0001').map((name) => context.measureText(name).width);
      setColumns(episodeColumnCount(widths, width));
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    // 首帧同步量一次：列数在绘制前就位，长标题页面不会先闪一下 5 列再重排
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(grid);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [signature]);

  return {
    ref,
    style: columns > 0 ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined,
  };
}
