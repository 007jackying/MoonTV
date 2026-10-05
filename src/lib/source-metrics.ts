/**
 * Cheap source measurement.
 *
 * The previous implementation (`getVideoResolutionFromM3u8` in lib/utils.ts)
 * spun up a full hls.js instance plus a detached <video> per source in order to
 * read `videoWidth`. That loads a manifest *and* media fragments, decodes them,
 * and carries a 4s hard timeout — far too expensive for a signal we only use to
 * rank sources in a side panel.
 *
 * Everything we need for ranking is available without decoding anything:
 *   - quality  -> #EXT-X-STREAM-INF carries RESOLUTION=WxH in the master playlist
 *   - latency  -> time to first byte of the manifest fetch
 *   - speed    -> one ranged GET of the first segment
 *
 * Streams that don't send CORS headers can't be measured this way (the browser
 * hands back an opaque response). In that case we fall back to the legacy
 * hls.js-based probe so behaviour never regresses.
 */

export interface SourceMetrics {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean;
  /** Measurement is at most CACHE_TTL old. */
  fromCache?: boolean;
}

const MANIFEST_TIMEOUT_MS = 4000;
const SEGMENT_TIMEOUT_MS = 6000;
/** Throughput probe size. Big enough to be meaningful, small enough to be cheap. */
const PROBE_BYTES = 192 * 1024;
const CACHE_KEY = 'moontv_source_metrics';
const CACHE_VERSION = '1';
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

// ---------------------------------------------------------------------------
// quality
// ---------------------------------------------------------------------------

/**
 * Same thresholds as the legacy probe, which read `video.videoWidth` — so
 * these are WIDTH cut-offs, not height. Keeping them width-based means the
 * labels users already know ("1080p" for 1920x1080) don't shift.
 */
export function qualityFromWidth(width: number): string {
  if (width >= 3840) return '4K';
  if (width >= 2560) return '2K';
  if (width >= 1920) return '1080p';
  if (width >= 1280) return '720p';
  if (width >= 854) return '480p';
  return 'SD';
}

const RESOLUTION_RE = /RESOLUTION=(\d+)x(\d+)/i;
const BANDWIDTH_RE = /BANDWIDTH=(\d+)/i;

/**
 * Pick the width of the highest-bandwidth variant in a master playlist.
 * Falls back to the first RESOLUTION seen when BANDWIDTH is absent.
 */
export function parseMasterQuality(manifest: string): {
  quality: string;
  bandwidth: number;
} {
  const lines = manifest.split('\n');
  let bestWidth = 0;
  let bestBandwidth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
    const res = line.match(RESOLUTION_RE);
    if (!res) continue;
    const width = Number(res[1]);
    const bw = Number(line.match(BANDWIDTH_RE)?.[1] ?? 0);
    // Strictly greater, so the first variant wins ties and order is stable.
    if (width > bestWidth || (width === bestWidth && bw > bestBandwidth)) {
      bestWidth = width;
      bestBandwidth = bw;
    }
  }

  if (!bestWidth) {
    // Media playlist: we can't know resolution, but BANDWIDTH is a decent proxy.
    const bw = Number(manifest.match(BANDWIDTH_RE)?.[1] ?? 0);
    return { quality: bw ? qualityFromBandwidth(bw) : '未知', bandwidth: bw };
  }
  return { quality: qualityFromWidth(bestWidth), bandwidth: bestBandwidth };
}

function qualityFromBandwidth(bps: number): string {
  if (bps >= 8_000_000) return '1080p';
  if (bps >= 4_000_000) return '720p';
  if (bps >= 1_500_000) return '480p';
  return 'SD';
}

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

/** Normalise KB/s or MB/s strings to KB/s. Mirrors the legacy helper. */
export function parseSpeedKBps(loadSpeed: string): number {
  const m = loadSpeed.match(/([\d.]+)\s*(KB|MB)\/s/i);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!isFinite(n)) return 0;
  return m[2].toUpperCase() === 'MB' ? n * 1024 : n;
}

export function formatSpeedKBps(kbps: number): string {
  if (!kbps || !isFinite(kbps) || kbps <= 0) return '未知';
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${Math.round(kbps)} KB/s`;
}

// ---------------------------------------------------------------------------
// cache
// ---------------------------------------------------------------------------

interface CacheShape {
  version: string;
  entries: Record<string, { at: number; metrics: SourceMetrics }>;
}

function readCache(): CacheShape {
  if (typeof window === 'undefined')
    return { version: CACHE_VERSION, entries: {} };
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { version: CACHE_VERSION, entries: {} };
    const parsed = JSON.parse(raw) as CacheShape;
    if (parsed?.version !== CACHE_VERSION || !parsed.entries)
      return { version: CACHE_VERSION, entries: {} };
    return parsed;
  } catch {
    return { version: CACHE_VERSION, entries: {} };
  }
}

function writeCache(cache: CacheShape) {
  if (typeof window === 'undefined') return;
  try {
    // Bound the size so a long browsing session can't grow this forever.
    const keys = Object.keys(cache.entries);
    if (keys.length > CACHE_MAX_ENTRIES) {
      keys
        .sort((a, b) => (cache.entries[a].at ?? 0) - (cache.entries[b].at ?? 0))
        .slice(0, keys.length - CACHE_MAX_ENTRIES)
        .forEach((k) => delete cache.entries[k]);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota exceeded or unavailable — the cache is best-effort */
  }
}

export function getCachedMetrics(url: string): SourceMetrics | null {
  const hit = readCache().entries[url];
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) return null;
  return { ...hit.metrics, fromCache: true };
}

export function clearMetricsCache() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// measurement
// ---------------------------------------------------------------------------

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** First media-segment URI in a media playlist. */
function firstSegment(playlist: string, baseUrl: string): string | null {
  const lines = playlist.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || l.startsWith('#')) continue;
    try {
      return new URL(l, baseUrl).toString();
    } catch {
      return null;
    }
  }
  return null;
}

function variantUri(manifest: string, baseUrl: string): string | null {
  const lines = manifest.split('\n');
  for (const l of lines) {
    const t = l.trim();
    if (!t || t.startsWith('#')) continue;
    try {
      return new URL(t, baseUrl).toString();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Read up to PROBE_BYTES from `url`, then cancel. Returns KB/s, or null.
 * Deliberately header-free so it stays a CORS "simple request".
 */
async function probeThroughput(url: string): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEGMENT_TIMEOUT_MS);
  const t0 = performance.now();
  let bytes = 0;
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    while (bytes < PROBE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.byteLength ?? 0;
    }
    // Stop the transfer; we already have enough to extrapolate.
    await reader.cancel().catch(() => undefined);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  const ms = performance.now() - t0;
  if (ms <= 0 || bytes <= 0) return null;
  return (bytes / 1024 / ms) * 1000;
}

export interface MeasureOptions {
  /** Injected so an expensive legacy probe can be used as a fallback. */
  fallback?: (url: string) => Promise<SourceMetrics>;
}

/**
 * Measure one source. Resolves (never rejects) — a failed measurement yields
 * `{ hasError: true }` so callers can render a single uniform shape.
 */
export async function measureSource(
  url: string,
  opts: MeasureOptions = {}
): Promise<SourceMetrics> {
  // A source with no episode for the requested index yields ''. Fetching that
  // would request the current page, parse the HTML as a playlist and return a
  // bogus (non-error) metric that could then win the ranking. Fail fast.
  if (!url || !/^https?:\/\//i.test(url)) {
    return { quality: '未知', loadSpeed: '未知', pingTime: 0, hasError: true };
  }

  const cached = getCachedMetrics(url);
  if (cached) return cached;

  const started = performance.now();
  try {
    const manifestRes = await fetchWithTimeout(
      url,
      { method: 'GET', cache: 'no-store' },
      MANIFEST_TIMEOUT_MS
    );
    if (!manifestRes.ok) throw new Error(`HTTP ${manifestRes.status}`);

    const manifest = await manifestRes.text();
    // TTFB ≈ time until the manifest body started arriving.
    const pingTime = Math.round(performance.now() - started);
    const { quality } = parseMasterQuality(manifest);

    // Throughput: one bounded GET of the first media segment.
    let speed: number | null = null;
    try {
      const isMaster = manifest.includes('#EXT-X-STREAM-INF');
      const target = isMaster
        ? variantUri(manifest, url)
        : firstSegment(manifest, url);
      if (target) {
        let playlist = manifest;
        if (isMaster && target) {
          const vRes = await fetchWithTimeout(
            target,
            { method: 'GET', cache: 'no-store' },
            MANIFEST_TIMEOUT_MS
          );
          playlist = vRes.ok ? await vRes.text() : '';
        }
        const seg = firstSegment(playlist, target);
        if (seg) {
          // Plain GET + early cancel rather than a Range request: a custom
          // `Range` header triggers a CORS preflight, which many of these
          // origins don't answer, and we'd lose the number entirely.
          const loadSpeed = await probeThroughput(seg);
          if (loadSpeed) speed = loadSpeed;
        }
      }
    } catch {
      /* throughput is optional; quality + latency are already known */
    }

    const metrics: SourceMetrics = {
      quality,
      loadSpeed: speed ? formatSpeedKBps(speed) : '未知',
      pingTime,
    };
    const cache = readCache();
    cache.entries[url] = { at: Date.now(), metrics };
    writeCache(cache);
    return metrics;
  } catch (err) {
    // No CORS headers, DNS failure, timeout... try the expensive probe once
    // before giving up, so we never regress vs the old behaviour.
    if (opts.fallback) {
      try {
        return await opts.fallback(url);
      } catch {
        /* fall through to the error shape */
      }
    }
    return {
      quality: '未知',
      loadSpeed: '未知',
      pingTime: 0,
      hasError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// concurrency
// ---------------------------------------------------------------------------

/**
 * Run `worker` over `items` with at most `limit` in flight. Unlike the previous
 * two-batch scheme, the first `limit` items start immediately and no later item
 * waits on an entire earlier batch to settle.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length));

  async function runner() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: size }, runner));
  return results;
}

// ---------------------------------------------------------------------------
// scoring
// ---------------------------------------------------------------------------

const QUALITY_SCORE: Record<string, number> = {
  '4K': 100,
  '2K': 85,
  '1080p': 75,
  '720p': 60,
  '480p': 40,
  SD: 20,
};

/**
 * Quality 40% + speed 40% + ping 20%, all three normalised to 0..100 so the
 * weights are comparable. Mirrors the previous `calculateSourceScore` weights
 * (and its 0..100 output) so the ordering users are used to doesn't shift.
 */
export function scoreMetrics(
  m: SourceMetrics,
  maxSpeed: number,
  minPing: number,
  maxPing: number
): number {
  const qualityScore = QUALITY_SCORE[m.quality] ?? 0;

  const speed = parseSpeedKBps(m.loadSpeed);
  // Unknown speed scores mid rather than zero, so a source is not punished
  // for a failed throughput probe.
  const speedScore = speed > 0 ? Math.min(100, (speed / maxSpeed) * 100) : 30;

  const ping = m.pingTime;
  const pingScore =
    ping <= 0
      ? 0
      : maxPing === minPing
      ? 100
      : Math.min(
          100,
          Math.max(0, ((maxPing - ping) / (maxPing - minPing)) * 100)
        );

  return (
    Math.round(
      (qualityScore * 0.4 + speedScore * 0.4 + pingScore * 0.2) * 100
    ) / 100
  );
}

export function boundsFor(all: SourceMetrics[]): {
  maxSpeed: number;
  minPing: number;
  maxPing: number;
} {
  const speeds = all
    .map((m) => parseSpeedKBps(m.loadSpeed))
    .filter((v) => v > 0);
  const pings = all.map((m) => m.pingTime).filter((v) => v > 0);
  return {
    maxSpeed: speeds.length ? Math.max(...speeds) : 1024,
    minPing: pings.length ? Math.min(...pings) : 50,
    maxPing: pings.length ? Math.max(...pings) : 1000,
  };
}

// ---------------------------------------------------------------------------
// advisory
// ---------------------------------------------------------------------------

const QUALITY_RANK: Record<string, number> = {
  '4K': 5,
  '2K': 4,
  '1080p': 3,
  '720p': 2,
  '480p': 1,
  SD: 0,
};

/** Higher is better; unknown quality sorts last. */
export function qualityRank(m: SourceMetrics): number {
  return QUALITY_RANK[m.quality] ?? -1;
}

/** Score lead a challenger needs before we bother the user about it. */
export const MIN_SUGGEST_GAP = 12;
/** Speed multiple that counts as a real difference rather than noise. */
export const MIN_SUGGEST_SPEED_RATIO = 1.3;

export interface SuggestDecision {
  suggest: boolean;
  reason:
    | 'same-source'
    | 'insufficient-lead'
    | 'quality-upgrade'
    | 'faster'
    | 'not-better';
}

/**
 * Should we offer the user a different source?
 *
 * Deliberately *offer*, never auto-apply: switching mid-playback loses the play
 * position, re-triggers resume and invalidates danmaku.
 *
 * Two independent reasons qualify, so a genuinely higher-resolution source is
 * still offered when it is no faster — measuring only speed would mean never
 * suggesting 4K on a fast connection, which is exactly when people want it.
 *
 * The score-gap threshold applies only to the *speed* reason. A one-tier
 * resolution bump on its own is worth 0.4 * (75-60) = 6 points, so requiring a
 * 12-point lead there would silently veto every quality upgrade when speed and
 * latency happen to tie. A resolution tier is a real difference, not noise; a
 * few percent of throughput is noise.
 */
export function decideSuggestion(
  best: SourceMetrics,
  current: SourceMetrics,
  sameSource: boolean,
  bestScore = 0,
  currentScore = 0
): SuggestDecision {
  if (sameSource) return { suggest: false, reason: 'same-source' };

  const qualityUp = qualityRank(best) > qualityRank(current);
  if (qualityUp) return { suggest: true, reason: 'quality-upgrade' };

  const speedLead =
    parseSpeedKBps(best.loadSpeed) >
    parseSpeedKBps(current.loadSpeed) * MIN_SUGGEST_SPEED_RATIO;
  if (speedLead && bestScore - currentScore >= MIN_SUGGEST_GAP) {
    return { suggest: true, reason: 'faster' };
  }

  return { suggest: false, reason: 'not-better' };
}
