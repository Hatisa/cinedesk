import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  name: string;
  urls: (string | undefined)[];
  className?: string;
  /** 首屏详情海报立即加载，列表海报沿用浏览器懒加载。 */
  eager?: boolean;
}

/** 占位图始终在底层；图片超时或失败后自动尝试其他来源，避免长期空白。 */
export default function PosterImage({ name, urls, className = '', eager = false }: Props) {
  const candidates = useMemo(() => [...new Set(urls.filter((url): url is string => Boolean(url)))], [urls.join('|')]);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef(0);
  const src = candidates[index];

  useEffect(() => {
    setIndex(0);
    setLoaded(false);
  }, [candidates]);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!src || loaded) return;
    timer.current = window.setTimeout(() => setIndex((i) => i + 1), 8000);
    return () => window.clearTimeout(timer.current);
  }, [src, loaded]);

  const next = () => {
    window.clearTimeout(timer.current);
    setIndex((i) => i + 1);
  };

  return (
    <div className={`poster-image ${className}${loaded ? ' loaded' : ''}`}>
      <div className={`poster-fallback${src && !loaded ? ' loading' : ''}`} aria-hidden={loaded}>
        <span>{name.slice(0, 4)}</span>
      </div>
      {src && (
        <img
          key={src}
          src={src}
          alt={name}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          referrerPolicy="no-referrer"
          onLoad={() => { window.clearTimeout(timer.current); setLoaded(true); }}
          onError={next}
        />
      )}
    </div>
  );
}
