import { boundsFor, scoreMetrics } from '@/lib/source-metrics';
import { SearchResult } from '@/lib/types';

import { episodeUrlOf, sourceKeyOf, VideoInfo } from './useSourceSpeedTest';

/**
 * 源的健康状况，数字越小越靠前：
 *   0 测速通过 —— 按评分排序
 *   1 还没有结果（测速中 / 未测）
 *   2 测速失败
 *   3 在播放器里实际播放失败过
 */
export type SourceHealth = 0 | 1 | 2 | 3;

export function healthOf(
  s: SearchResult,
  infoMap: Map<string, VideoInfo>,
  failedKeys: ReadonlySet<string>
): SourceHealth {
  const key = sourceKeyOf(s);
  if (failedKeys.has(key)) return 3;
  const info = infoMap.get(key);
  if (!info) return 1;
  return info.hasError ? 2 : 0;
}

/** 测速通过的源的评分（与优选使用同一套打分），键为 sourceKeyOf。 */
export function scoresOf(
  sources: SearchResult[],
  infoMap: Map<string, VideoInfo>
): Map<string, number> {
  const ok = sources
    .map((s) => ({ key: sourceKeyOf(s), info: infoMap.get(sourceKeyOf(s)) }))
    .filter(
      (x): x is { key: string; info: VideoInfo } => !!x.info && !x.info.hasError
    );
  const scores = new Map<string, number>();
  if (ok.length === 0) return scores;
  const { maxSpeed, minPing, maxPing } = boundsFor(ok.map((x) => x.info));
  ok.forEach((x) =>
    scores.set(x.key, scoreMetrics(x.info, maxSpeed, minPing, maxPing))
  );
  return scores;
}

/**
 * 按健康状况排序：测速通过且评分高的在前，播放失败的沉底。
 * 同一档内保持原顺序（稳定排序），列表不会无端跳动。
 */
export function rankSources(
  sources: SearchResult[],
  infoMap: Map<string, VideoInfo>,
  failedKeys: ReadonlySet<string>
): SearchResult[] {
  const scores = scoresOf(sources, infoMap);
  return sources
    .map((s, index) => ({
      s,
      index,
      health: healthOf(s, infoMap, failedKeys),
      score: scores.get(sourceKeyOf(s)) ?? -1,
    }))
    .sort(
      (a, b) => a.health - b.health || b.score - a.score || a.index - b.index
    )
    .map((x) => x.s);
}

export type FailoverDecision =
  | { kind: 'switch'; source: SearchResult }
  /** 还有源在测速或搜索仍在进行，等结果出来再挑 */
  | { kind: 'wait' }
  /** 没有可以再试的源了 */
  | { kind: 'exhausted' };

export interface FailoverArgs {
  sources: SearchResult[];
  currentKey: string;
  episodeIndex: number;
  infoMap: Map<string, VideoInfo>;
  failedKeys: ReadonlySet<string>;
  /** 测速开关关闭时不会有测速结果，不能干等 */
  speedTestEnabled: boolean;
  /** 搜索仍在流式返回结果 */
  searchLoading: boolean;
}

/**
 * 当前源播放失败后，挑下一个要自动切换的源。
 *
 * 优先测速通过且评分最高的源；都还没测完时先等（测速有超时，不会一直等）；
 * 测速关闭时按列表顺序挑；只剩测速失败的源时把它们当作最后的尝试——
 * 测速走的是轻量探测，探测失败不一定代表播放器也放不了。
 * 播放失败过的源永远不会再被自动选中，所以这个过程一定会终止。
 */
export function pickFailoverSource({
  sources,
  currentKey,
  episodeIndex,
  infoMap,
  failedKeys,
  speedTestEnabled,
  searchLoading,
}: FailoverArgs): FailoverDecision {
  const candidates = sources.filter((s) => {
    const key = sourceKeyOf(s);
    return (
      key !== currentKey &&
      !failedKeys.has(key) &&
      episodeUrlOf(s, episodeIndex) !== ''
    );
  });

  const ranked = rankSources(candidates, infoMap, failedKeys);
  const best = ranked[0];
  if (best && healthOf(best, infoMap, failedKeys) === 0) {
    return { kind: 'switch', source: best };
  }

  const untested = ranked.find((s) => healthOf(s, infoMap, failedKeys) === 1);
  if (untested) {
    return speedTestEnabled
      ? { kind: 'wait' }
      : { kind: 'switch', source: untested };
  }

  // 搜索还在进行：更多的源可能马上就到
  if (searchLoading) return { kind: 'wait' };

  if (best) return { kind: 'switch', source: best };
  return { kind: 'exhausted' };
}
