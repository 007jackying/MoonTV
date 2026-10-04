'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8 } from '@/lib/utils';

export interface VideoInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean;
}

export const sourceKeyOf = (s: { source: string; id: string }) =>
  `${s.source}-${s.id}`;

/**
 * 播放源测速（分辨率 / 下载速度 / 延迟）。
 * 当前源总是会测；其它源在 testAll 为 true（用户展开了源列表）时分两批测。
 * 优选时已有的结果通过 precomputed 合并进来，避免重复测速。
 */
export function useSourceSpeedTest(
  sources: SearchResult[],
  current: SearchResult | null,
  testAll: boolean,
  precomputed?: Map<string, VideoInfo>
) {
  const [infoMap, setInfoMap] = useState<Map<string, VideoInfo>>(new Map());
  const attemptedRef = useRef<Set<string>>(new Set());

  // 读取本地“优选和测速”开关，默认开启
  const [enabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const saved = localStorage.getItem('enableOptimization');
      return saved === null ? true : JSON.parse(saved);
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (!precomputed || precomputed.size === 0) return;
    setInfoMap((prev) => {
      const next = new Map(prev);
      precomputed.forEach((v, k) => next.set(k, v));
      return next;
    });
    precomputed.forEach((info, key) => {
      if (!info.hasError) attemptedRef.current.add(key);
    });
  }, [precomputed]);

  const test = useCallback(async (source: SearchResult) => {
    const key = sourceKeyOf(source);
    if (attemptedRef.current.has(key)) return;
    if (!source.episodes || source.episodes.length === 0) return;
    attemptedRef.current.add(key);
    const url =
      source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];
    try {
      const info = await getVideoResolutionFromM3u8(url);
      setInfoMap((prev) => new Map(prev).set(key, info));
    } catch {
      setInfoMap((prev) =>
        new Map(prev).set(key, {
          quality: '错误',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
        })
      );
    }
  }, []);

  useEffect(() => {
    if (enabled && current) test(current);
  }, [enabled, current, test]);

  useEffect(() => {
    if (!enabled || !testAll || sources.length === 0) return;
    const pending = sources.filter(
      (s) => !attemptedRef.current.has(sourceKeyOf(s))
    );
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      const batchSize = Math.ceil(pending.length / 2);
      for (let i = 0; i < pending.length && !cancelled; i += batchSize) {
        await Promise.all(pending.slice(i, i + batchSize).map(test));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, testAll, sources, test]);

  const isMeasuring = useCallback(
    (s: SearchResult) =>
      enabled &&
      attemptedRef.current.has(sourceKeyOf(s)) &&
      !infoMap.has(sourceKeyOf(s)),
    [enabled, infoMap]
  );

  return { infoMap, isMeasuring, enabled };
}
