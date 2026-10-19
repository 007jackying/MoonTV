/**
 * 去广告：从 HLS 媒体播放列表里删掉插播广告的切片。
 *
 * 采集站的广告是整段插进播放列表的：前后各一个 #EXT-X-DISCONTINUITY，中间是广告切片。
 * 旧实现只删掉 #EXT-X-DISCONTINUITY 标记、广告切片原样保留，是否还能看到广告全看时间戳
 * 碰巧落在哪里：插在中间且时间戳从头开始的广告会落到已播放的位置而“消失”，片头广告照样
 * 播放并吞掉正片开头，时间戳不相关的广告会让播放卡死；同时播放列表的时长和真实时间轴对
 * 不上，续播、拖动都会偏移（见 docs/DEV_LOG.md 2026-10-19）。
 *
 * 现在的做法：
 * 1. 按 #EXT-X-DISCONTINUITY 把切片分成若干组；
 * 2. 只有不超过 MAX_AD_GROUP_SECONDS 的组才可能是广告，按下列任一规则判定：
 *    - 时长指纹：与抽帧确认过的已知广告完全一致（广告与正片路径、帧率都相同时只能靠它）；
 *    - 路径：组内切片都不在正片所在的目录；
 *    - 命名：组内切片的命名规则（目录 + 去掉末尾序号的文件名）都与正片不同；
 *    - 帧率：组内一半以上时长的切片落不到正片的任何一个帧网格上
 *      （如正片 25fps，切片都是 0.04 的整数倍；广告 30fps，切片是 5.567、3.333 这类）；
 *    - 序号：正片切片按序号命名，前后两组首尾相接，而这一组插不进去；
 * 3. 删掉广告组，正片组之间的 #EXT-X-DISCONTINUITY 原样保留：正片各组的时间戳可能各自
 *    从头开始，去掉标记会让播放器把它们叠到错误的位置；
 * 4. 一旦判定结果要删掉超过总时长 MAX_REMOVED_RATIO 的内容，说明规则不适用于这个片源，
 *    原样返回，宁可留着广告也不能删正片。
 *
 * 规则、阈值以及测试里的真实片源数据参考了 Chongjian528/MoonTV#2、#3（MIT）。
 */

/** 超过这个时长的组一律视为正片（秒） */
export const MAX_AD_GROUP_SECONDS = 120;
/** 删除内容超过总时长的这个比例时放弃去广告 */
export const MAX_REMOVED_RATIO = 1 / 3;

/**
 * 已知广告的切片时长指纹：每项是相邻的若干组，组内时长保留两位小数。
 * 同一段广告会被插进不同影片；较短的指纹必须与相邻组一起命中，避免误删正片。
 */
const KNOWN_AD_FINGERPRINTS: string[][] = [
  // 非凡、电影天堂
  ['5.57,3.2', '5.37,3.33,1.6'],
  ['5.57,2.93,5.7', '3.33,1.53'],
  ['6.67,2.13', '3.23,3.73'],
  ['6.67', '2.13,3.23,3.73'],
  ['4.87,3.33,5.6,2.87,2.97'],
  ['6.96,4,2.56,3.84'],
  // 如意
  ['4,5.48,2.92,4,4.32,1.28'],
  ['4,4,4,4,4,1'],
  // 量子
  ['4,4,4,4,4,4,1.7'],
  // iKun、魔都
  ['3,3,5,3,3,0.64'],
  ['3.33,1.67,1.67,2.93,1.67,1.67,1.67,1.67,1.3'],
];

/** 常见帧率的单帧时长：25、30、24、23.976、29.97 fps */
const FRAME_STEPS = [1 / 25, 1 / 30, 1 / 24, 1001 / 24000, 1001 / 30000];
/** #EXTINF 通常保留三位小数，允许的舍入误差（秒） */
const FRAME_TOLERANCE = 0.0006;
/** 正片至少这么多时长落在某个帧网格上，才认为正片是这个帧率 */
const FRAME_GRID_COVERAGE = 0.9;
/** 某个命名特征至少覆盖这么多时长，才当作正片的命名规则 */
const DOMINANT_RATIO = 0.5;
/** 相邻切片序号连续的比例达到这个值，才认为切片按序号命名 */
const SEQUENTIAL_RATIO = 0.8;

export type AdReason =
  | 'fingerprint'
  | 'path'
  | 'naming'
  | 'frame-rate'
  | 'sequence';

export interface RemovedAdGroup {
  /** 第几组（从 0 开始，按 #EXT-X-DISCONTINUITY 划分） */
  group: number;
  segments: number;
  seconds: number;
  reason: AdReason;
}

export interface AdFilterResult {
  playlist: string;
  removed: RemovedAdGroup[];
}

interface Segment {
  duration: number;
  /**
   * 所在目录的路径部分（不含域名和查询参数）。不比较域名：有的片源把正片切片轮流
   * 分到几个 CDN 域名上，按域名比会把正片误判成广告
   */
  dir: string;
  /** 目录 + 把末尾序号换成 # 的文件名，如 /a/b/abc#.ts */
  pattern: string;
  /** 文件名末尾的序号，没有则为 null */
  seq: number | null;
}

interface Group {
  lines: string[];
  segments: Segment[];
  seconds: number;
}

/** 切片地址的路径部分；相对地址按播放列表地址解析 */
function pathOf(uri: string, baseUrl?: string): string {
  try {
    return new URL(uri, baseUrl).pathname;
  } catch {
    return uri.split(/[?#]/)[0];
  }
}

function describeSegment(
  uri: string,
  duration: number,
  baseUrl?: string
): Segment {
  const path = pathOf(uri, baseUrl);
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const m = name.match(/^(.*?)(\d+)(\.[a-z0-9]+)?$/i);
  return {
    duration,
    dir,
    pattern: m ? `${dir}${m[1]}#${m[3] || ''}` : `${dir}${name}`,
    // 太长的数字串多半是哈希的一部分，不当序号
    seq: m && m[2].length <= 9 ? parseInt(m[2], 10) : null,
  };
}

/** 广告组里的这些标签对后面的正片切片仍然生效，删组时要留下 */
function isCarriedTag(line: string): boolean {
  return (
    line.startsWith('#EXT-X-KEY') ||
    line.startsWith('#EXT-X-MAP') ||
    line.startsWith('#EXT-X-BYTERANGE')
  );
}

function parse(content: string, baseUrl?: string) {
  const header: string[] = [];
  const footer: string[] = [];
  const groups: Group[] = [];
  let current: Group = { lines: [], segments: [], seconds: 0 };
  let inBody = false;
  let pending = 0;

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (
      line.startsWith('#EXT-X-DISCONTINUITY') &&
      !line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE')
    ) {
      inBody = true;
      if (current.lines.length) groups.push(current);
      current = { lines: [], segments: [], seconds: 0 };
      continue;
    }
    // #EXT-X-ENDLIST 及其后的内容（通常只有结尾换行）原样放在最后
    if (footer.length || line.startsWith('#EXT-X-ENDLIST')) {
      footer.push(raw);
      continue;
    }
    if (!inBody && !line.startsWith('#EXTINF') && !isCarriedTag(line)) {
      header.push(raw);
      continue;
    }
    inBody = true;
    current.lines.push(raw);
    if (line.startsWith('#EXTINF')) {
      pending = parseFloat(line.slice('#EXTINF:'.length)) || 0;
    } else if (line && !line.startsWith('#')) {
      current.segments.push(describeSegment(line, pending, baseUrl));
      current.seconds += pending;
      pending = 0;
    }
  }
  if (current.lines.length) groups.push(current);
  return { header, footer, groups };
}

const round2 = (d: number) => String(Math.round(d * 100) / 100);

function fingerprintHits(groups: Group[]): Set<number> {
  const prints = groups.map((g) =>
    g.segments.map((s) => round2(s.duration)).join(',')
  );
  const hits = new Set<number>();
  for (const pattern of KNOWN_AD_FINGERPRINTS) {
    for (let i = 0; i + pattern.length <= prints.length; i++) {
      if (pattern.every((p, k) => prints[i + k] === p)) {
        pattern.forEach((_, k) => hits.add(i + k));
      }
    }
  }
  return hits;
}

/** 按时长占比最大的特征；不到 DOMINANT_RATIO 说明这个特征不稳定（如随机哈希文件名） */
function dominant(
  groups: Group[],
  pick: (s: Segment) => string
): string | null {
  const bySig = new Map<string, number>();
  let total = 0;
  for (const g of groups) {
    for (const s of g.segments) {
      bySig.set(pick(s), (bySig.get(pick(s)) || 0) + s.duration);
      total += s.duration;
    }
  }
  let best: string | null = null;
  let bestSeconds = 0;
  bySig.forEach((seconds, sig) => {
    if (seconds > bestSeconds) {
      best = sig;
      bestSeconds = seconds;
    }
  });
  return total > 0 && bestSeconds / total >= DOMINANT_RATIO ? best : null;
}

function onGrid(duration: number, step: number): boolean {
  const frames = Math.round(duration / step);
  return frames > 0 && Math.abs(duration - frames * step) <= FRAME_TOLERANCE;
}

/** 正片可能的帧率（单帧时长）：覆盖至少 FRAME_GRID_COVERAGE 的全部网格 */
function contentFrameSteps(groups: Group[]): number[] {
  let total = 0;
  const covered = FRAME_STEPS.map(() => 0);
  for (const g of groups) {
    for (const s of g.segments) {
      total += s.duration;
      FRAME_STEPS.forEach((step, i) => {
        if (onGrid(s.duration, step)) covered[i] += s.duration;
      });
    }
  }
  if (total <= 0) return [];
  return FRAME_STEPS.filter(
    (_, i) => covered[i] / total >= FRAME_GRID_COVERAGE
  );
}

function namesAreSequential(groups: Group[]): boolean {
  let pairs = 0;
  let consecutive = 0;
  for (const g of groups) {
    for (let i = 1; i < g.segments.length; i++) {
      pairs++;
      const a = g.segments[i - 1].seq;
      const b = g.segments[i].seq;
      if (a !== null && b === a + 1) consecutive++;
    }
  }
  return pairs > 0 && consecutive / pairs >= SEQUENTIAL_RATIO;
}

/**
 * 删掉媒体播放列表里的广告组。不是媒体播放列表（如主播放列表）、只有一组、
 * 找不到广告或判定结果不可信时，原样返回内容。
 */
export function removeAdsFromM3U8(
  content: string,
  baseUrl?: string
): AdFilterResult {
  const unchanged = { playlist: content, removed: [] };
  if (!content || !content.includes('#EXTINF')) return unchanged;

  const { header, footer, groups } = parse(content, baseUrl);
  if (groups.length < 2) return unchanged;

  const fingerprints = fingerprintHits(groups);
  const mainDir = dominant(groups, (s) => s.dir);
  const mainPattern = dominant(groups, (s) => s.pattern);
  const frameSteps = contentFrameSteps(groups);
  const sequential = namesAreSequential(groups);
  const firstSeq = (g: Group) => g.segments[0]?.seq ?? null;
  const lastSeq = (g: Group) => g.segments[g.segments.length - 1]?.seq ?? null;

  const reasonFor = (g: Group, i: number): AdReason | null => {
    if (!g.segments.length || g.seconds > MAX_AD_GROUP_SECONDS) return null;
    if (fingerprints.has(i)) return 'fingerprint';
    if (mainDir && g.segments.every((s) => s.dir !== mainDir)) return 'path';
    if (mainPattern && g.segments.every((s) => s.pattern !== mainPattern)) {
      return 'naming';
    }
    // 只在与正片的每一种可能帧率都对不上时才算：正片切片都是整数秒时，
    // 25、30、24 fps 网格同时成立，这时无法用帧率区分
    if (
      frameSteps.length &&
      frameSteps.every((step) => {
        const off = g.segments
          .filter((s) => !onGrid(s.duration, step))
          .reduce((sum, s) => sum + s.duration, 0);
        return off * 2 >= g.seconds;
      })
    ) {
      return 'frame-rate';
    }
    const prev = groups[i - 1];
    const next = groups[i + 1];
    if (sequential && prev && next) {
      const before = lastSeq(prev);
      const after = firstSeq(next);
      if (
        before !== null &&
        after === before + 1 &&
        firstSeq(g) !== before + 1
      ) {
        return 'sequence';
      }
    }
    return null;
  };

  const removed: RemovedAdGroup[] = [];
  groups.forEach((g, i) => {
    const reason = reasonFor(g, i);
    if (reason) {
      removed.push({
        group: i,
        segments: g.segments.length,
        seconds: g.seconds,
        reason,
      });
    }
  });
  if (!removed.length) return unchanged;

  const total = groups.reduce((sum, g) => sum + g.seconds, 0);
  const removedSeconds = removed.reduce((sum, r) => sum + r.seconds, 0);
  if (removedSeconds > total * MAX_REMOVED_RATIO) return unchanged;

  const adGroups = new Set(removed.map((r) => r.group));
  const body: string[] = [];
  let kept = 0;
  groups.forEach((g, i) => {
    if (adGroups.has(i)) {
      body.push(...g.lines.filter((l) => isCarriedTag(l.trim())));
      return;
    }
    if (kept > 0) body.push('#EXT-X-DISCONTINUITY');
    body.push(...g.lines);
    kept++;
  });

  return { playlist: [...header, ...body, ...footer].join('\n'), removed };
}
