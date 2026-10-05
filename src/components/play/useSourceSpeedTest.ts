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

/** 一组预先测好的结果，以及它们是针对哪一集测的。 */
export interface PrecomputedVideoInfo {
  episodeIndex: number;
  info: Map<string, VideoInfo>;
}

export interface UseSourceSpeedTestArgs {
  sources: SearchResult[];
  current: SearchResult | null;
  testAll: boolean;
  precomputed?: PrecomputedVideoInfo | null;
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
 * 当前集有地址的源（没有地址的测了也是错误结果，直接跳过），
 * 当前源排第一：它的数字用户最先看到，并发打满时也不该排在后面。
 * 评分相同时排序是稳定的，所以平分也会留在当前源上，不会无端建议换源。
 */
export function measurableCurrentFirst(
  sources: SearchResult[],
  episodeIndex: number,
  currentKey: string
): SearchResult[] {
  const playable = sources.filter((s) => episodeUrlOf(s, episodeIndex) !== '');
  const current = playable.filter((s) => sourceKeyOf(s) === currentKey);
  const rest = playable.filter((s) => sourceKeyOf(s) !== currentKey);
  return [...current, ...rest];
}

/**
 * 测速结果按"源 + 集"记：同一个源的不同集常常在不同的上游文件上，
 * 换集后沿用第 1 集的数字会是错的，而不只是旧的。
 */
const measureKeyOf = (
  s: { source: string; id: string },
  episodeIndex: number
) => `${sourceKeyOf(s)}#${episodeIndex}`;

/**
 * 播放源测速（分辨率 / 下载速度 / 延迟）。
 *
 * 当前源总是会测；其它源在 testAll 为 true（用户展开了源列表）时才测，
 * 且一次并发 CONCURRENCY 个。优选时已有的结果通过 precomputed 合并进来，
 * 避免重复测速。测速本身走 lib/source-metrics 的轻量实现：解析
 * #EXT-X-STREAM-INF 的 RESOLUTION 拿分辨率，manifest 的 TTFB 拿延迟，
 * 一次 GET 首个分片（读够就取消）拿带宽——不再为每个源起一个 hls.js 实例。
 *
 * 返回的 infoMap 以 sourceKeyOf 为键，只包含当前集的结果。
 */
export function useSourceSpeedTest({
  sources,
  current,
  testAll,
  precomputed,
  episodeIndex = 0,
}: UseSourceSpeedTestArgs) {
  // 键为 measureKeyOf（源 + 集）
  const [results, setResults] = useState<Map<string, VideoInfo>>(new Map());
  // 正在测的键。用 state 而不是 ref：开始测时就要重渲染，"测速中"才能及时显示
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());
  const attemptedRef = useRef<Set<string>>(new Set());

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
    if (!precomputed || precomputed.info.size === 0) return;
    const ep = precomputed.episodeIndex;
    setResults((prev) => {
      const next = new Map(prev);
      precomputed.info.forEach((v, k) => next.set(`${k}#${ep}`, v));
      return next;
    });
    precomputed.info.forEach((info, key) => {
      if (!info.hasError) attemptedRef.current.add(`${key}#${ep}`);
    });
  }, [precomputed]);

  const test = useCallback(
    async (source: SearchResult) => {
      const key = measureKeyOf(source, episodeIndex);
      // 每个（源, 集）只测一次；失败结果也会写进 results
      if (attemptedRef.current.has(key)) return;
      const url = episodeUrlOf(source, episodeIndex);
      if (!url) return;
      attemptedRef.current.add(key);
      setInFlight((prev) => new Set(prev).add(key));
      let info: VideoInfo;
      try {
        info = await measureSource(url);
      } catch {
        info = {
          quality: '未知',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
        };
      }
      setResults((prev) => new Map(prev).set(key, info));
      setInFlight((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    },
    [episodeIndex]
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
        !attemptedRef.current.has(measureKeyOf(s, episodeIndex)) &&
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

  // 对外只暴露当前集的结果，键仍是 sourceKeyOf，调用方不用关心集数
  const infoMap = useMemo(() => {
    const suffix = `#${episodeIndex}`;
    const out = new Map<string, VideoInfo>();
    results.forEach((v, k) => {
      if (k.endsWith(suffix)) out.set(k.slice(0, -suffix.length), v);
    });
    return out;
  }, [results, episodeIndex]);

  const isMeasuring = useCallback(
    (s: SearchResult) => enabled && inFlight.has(measureKeyOf(s, episodeIndex)),
    [enabled, inFlight, episodeIndex]
  );

  return useMemo(
    () => ({ infoMap, isMeasuring, enabled }),
    [infoMap, isMeasuring, enabled]
  );
}
