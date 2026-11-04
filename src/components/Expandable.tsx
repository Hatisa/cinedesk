import { useEffect, useState } from 'react';

/** 详情页主演/简介按 2 行/3 行折叠，避免信息过载。 */
export function useExpandable(resetKey: unknown = 0) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setExpanded(false); }, [resetKey]);
  return { expanded, toggle: () => setExpanded((v) => !v) };
}
