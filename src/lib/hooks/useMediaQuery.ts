'use client';

import { useEffect, useState } from 'react';

/**
 * 订阅一个媒体查询。服务端和首帧返回 initial，挂载后按真实结果更新。
 */
export function useMediaQuery(query: string, initial = false): boolean {
  const [matches, setMatches] = useState(initial);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}
