'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  mapWithConcurrency,
  measureSource,
  SourceMetrics,
} from '@/lib/source-metrics';
import { SearchResult } from '@/lib/types';

export type VideoInfo = SourceMetrics;

export const sourceKeyOf = (s: { source: string; id: string }) =>
  `${s.source}-${s.id}`;

/** 测速并发上限 */
const CONCURRENCY = 6;

export interface UseSourceSpeedTestArgs {
  sources: SearchResult[];
  current: SearchResult | null;
  testAll: boolean;
  precomputed?: Map<string, VideoInfo>;
  /** 当前集下标：测的就是这一集的地址，不是固定 episodes[1]。 */
  episodeIndex?: number;
}

/** 取某个源在指定集数的播放地址 */
export function episodeUrlOf(source: SearchResult, index: number): string {
  const eps = source.episodes || [];
  if (eps.length === 0) return '';
  return eps[Math.min(Math.max(0, index), eps.length - 1)] || '';
}

/**
 * 播放源测速（分辨率 / 下载速度 / 延迟）。
 *
 * 当前源总是会测；其它源在 testAll 为 true（用户展开了源列表）时才测，
 * 且一次并发 CONCURRENCY 个。优选时已有的结果通过 precomputed 合并进来，
 * 避免重复测速。测速本身走 lib/source-metrics 的轻量实现：解析
 * #EXT-X-STREAM-INF 的 RESOLUTION 拿分辨率，manifest 的 TTFB 拿延迟，
 * 一次 Range 请求首个分片拿带宽——不再为每个源起一个 hls.js 实例。
 */
export function useSourceSpeedTest({
  sources,
  current,
  testAll,
  precomputed,
  episodeIndex = 0,
}: UseSourceSpeedTestArgs) {
  const [infoMap, setInfoMap] = useState<Map<string, VideoInfo>>(new Map());
  const attemptedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());

  // 读取本地"优选和测速"开关，默认开启
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

  const record = useCallback((key: string, info: VideoInfo) => {
    setInfoMap((prev) => new Map(prev).set(key, info));
    inFlightRef.current.delete(key);
  }, []);

  const test = useCallback(
    async (source: SearchResult) => {
      const key = sourceKeyOf(source);
      if (attemptedRef.current.has(key)) return;
      if (inFlightRef.current.has(key)) return;
      const url = episodeUrlOf(source, episodeIndex);
      if (!url) return;
      // 标记为"测过"避免重复排队；失败也会写进 infoMap，可以重试
      attemptedRef.current.add(key);
      inFlightRef.current.add(key);
      try {
        const info = await measureSource(url);
        record(key, info);
      } catch {
        record(key, {
          quality: '未知',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
        });
      }
    },
    [episodeIndex, record]
  );

  // 当前源优先测，且只测它 —— 用户最需要这个数字
  useEffect(() => {
    if (enabled && current) void test(current);
  }, [enabled, current, test]);

  // 展开源列表后再测其余源
  useEffect(() => {
    if (!enabled || !testAll || sources.length === 0) return;
    const pending = sources.filter(
      (s) =>
        !attemptedRef.current.has(sourceKeyOf(s)) &&
        episodeUrlOf(s, episodeIndex) !== ''
    );
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      await mapWithConcurrency(pending, CONCURRENCY, async (s) => {
        if (cancelled) return;
        await test(s);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, testAll, sources, test, episodeIndex]);

  const isMeasuring = useCallback(
    (s: SearchResult) =>
      enabled &&
      (inFlightRef.current.has(sourceKeyOf(s)) ||
        (attemptedRef.current.has(sourceKeyOf(s)) &&
          !infoMap.has(sourceKeyOf(s)))),
    [enabled, infoMap]
  );

  return useMemo(
    () => ({ infoMap, isMeasuring, enabled }),
    [infoMap, isMeasuring, enabled]
  );
}
