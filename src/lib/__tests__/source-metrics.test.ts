import {
  boundsFor,
  decideSuggestion,
  formatSpeedKBps,
  qualityRank,
  mapWithConcurrency,
  measureSource,
  parseMasterQuality,
  parseSpeedKBps,
  qualityFromWidth,
  scoreMetrics,
  SourceMetrics,
} from '@/lib/source-metrics';

const master1080 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=1388944,AVERAGE-BANDWIDTH=1273261,RESOLUTION=1280x720,CODECS="avc1.42c01f,mp4a.40.2"
v0.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4148855,AVERAGE-BANDWIDTH=3961200,RESOLUTION=1920x1080,CODECS="avc1.42c028,mp4a.40.2"
v1.m3u8
`;

const master4k = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1388944,RESOLUTION=1280x720
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=14208556,RESOLUTION=3840x2160
high.m3u8
`;

const mediaPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXTINF:2.000000,
seg_000.ts
#EXTINF:2.000000,
seg_001.ts
#EXT-X-ENDLIST
`;

describe('source-metrics', () => {
  describe('qualityFromWidth', () => {
    it.each([
      [3840, '4K'],
      [2560, '2K'],
      [1920, '1080p'],
      [1280, '720p'],
      [854, '480p'],
      [640, 'SD'],
    ])('maps width %ipx to %s', (h, expected) => {
      expect(qualityFromWidth(h)).toBe(expected);
    });
  });

  describe('parseMasterQuality', () => {
    it('picks the highest-resolution variant', () => {
      expect(parseMasterQuality(master1080).quality).toBe('1080p');
    });

    it('reports 4K when a 2160p variant exists', () => {
      expect(parseMasterQuality(master4k).quality).toBe('4K');
    });

    it('falls back to bandwidth for a media playlist with no RESOLUTION', () => {
      const r = parseMasterQuality(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5500000\nv0.m3u8\n'
      );
      expect(r.quality).toBe('720p');
    });

    it('returns 未知 when nothing is parseable', () => {
      expect(parseMasterQuality('not a playlist').quality).toBe('未知');
    });

    it('is stable when bandwidth ties', () => {
      const tie = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=1280x720
a.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=1280x720
b.m3u8
`;
      expect(parseMasterQuality(tie).quality).toBe('720p');
    });
  });

  describe('speed formatting', () => {
    it('formats KB/s below 1MB/s', () => {
      expect(formatSpeedKBps(512)).toBe('512 KB/s');
    });

    it('formats MB/s at or above 1MB/s', () => {
      expect(formatSpeedKBps(2048)).toBe('2.0 MB/s');
    });

    it('returns 未知 for zero or negative', () => {
      expect(formatSpeedKBps(0)).toBe('未知');
      expect(formatSpeedKBps(-5)).toBe('未知');
    });

    it('parses both units back to KB/s', () => {
      expect(parseSpeedKBps('2.0 MB/s')).toBe(2048);
      expect(parseSpeedKBps('512 KB/s')).toBe(512);
      expect(parseSpeedKBps('未知')).toBe(0);
      expect(parseSpeedKBps('')).toBe(0);
    });

    it('round-trips', () => {
      expect(parseSpeedKBps(formatSpeedKBps(1536))).toBeCloseTo(1536, 0);
    });
  });

  describe('mapWithConcurrency', () => {
    it('preserves input order in the results', async () => {
      const out = await mapWithConcurrency([5, 1, 4, 2, 3], 2, async (n) => {
        await new Promise((r) => setTimeout(r, n));
        return n * 10;
      });
      expect(out).toEqual([50, 10, 40, 20, 30]);
    });

    it('never exceeds the concurrency limit', async () => {
      let active = 0;
      let peak = 0;
      await mapWithConcurrency(
        Array.from({ length: 12 }, (_, i) => i),
        3,
        async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }
      );
      expect(peak).toBeLessThanOrEqual(3);
      expect(peak).toBeGreaterThan(1);
    });

    it('handles an empty list', async () => {
      await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual(
        []
      );
    });

    it('does not serialise into batches: item n+1 need not wait for n', async () => {
      // With 6 items and limit 6, everything starts at once, so the total
      // time is the slowest single item rather than the sum.
      const t0 = Date.now();
      await mapWithConcurrency([1, 2, 3, 4, 5, 6], 6, async (n) => {
        await new Promise((r) => setTimeout(r, n * 20));
        return n;
      });
      // sum would be 420ms; concurrent is ~120ms
      expect(Date.now() - t0).toBeLessThan(380);
    });
  });

  describe('scoring', () => {
    const bounds = { maxSpeed: 2048, minPing: 20, maxPing: 200 };
    const base: SourceMetrics = {
      quality: '1080p',
      loadSpeed: '2048 KB/s',
      pingTime: 20,
    };

    it('gives the best possible source the maximum score', () => {
      const perfect: SourceMetrics = { ...base, quality: '4K' };
      expect(
        scoreMetrics(perfect, bounds.maxSpeed, bounds.minPing, bounds.maxPing)
      ).toBe(100);
    });

    it('scores 1080p at 90 when speed and ping are both optimal', () => {
      // 75*0.4 + 100*0.4 + 100*0.2
      expect(
        scoreMetrics(base, bounds.maxSpeed, bounds.minPing, bounds.maxPing)
      ).toBe(90);
    });

    it('penalises low speed', () => {
      const slow = { ...base, loadSpeed: '64 KB/s' };
      expect(
        scoreMetrics(slow, bounds.maxSpeed, bounds.minPing, bounds.maxPing)
      ).toBeLessThan(55);
    });

    it('penalises high latency', () => {
      const laggy = { ...base, pingTime: 200 };
      expect(
        scoreMetrics(laggy, bounds.maxSpeed, bounds.minPing, bounds.maxPing)
      ).toBeLessThan(90);
    });

    it('does not divide by zero when every ping is identical', () => {
      const s = scoreMetrics(base, bounds.maxSpeed, 50, 50);
      expect(Number.isFinite(s)).toBe(true);
    });

    it('weights quality at 40% of the total', () => {
      // same speed+ping, only quality differs => 0.4 * (100-55)
      const lowQ: SourceMetrics = { ...base, quality: '720p' };
      const diff =
        scoreMetrics(base, bounds.maxSpeed, bounds.minPing, bounds.maxPing) -
        scoreMetrics(lowQ, bounds.maxSpeed, bounds.minPing, bounds.maxPing);
      expect(diff).toBeCloseTo(0.4 * (75 - 60), 5);
    });
  });

  describe('boundsFor', () => {
    it('derives min/max ping and max speed from the set', () => {
      const b = boundsFor([
        { quality: '720p', loadSpeed: '1024 KB/s', pingTime: 40 },
        { quality: '1080p', loadSpeed: '2.0 MB/s', pingTime: 90 },
        { quality: 'SD', loadSpeed: '未知', pingTime: 0 },
      ]);
      expect(b.maxSpeed).toBe(2048);
      expect(b.minPing).toBe(40);
      expect(b.maxPing).toBe(90);
    });

    it('falls back to sane defaults for an empty set', () => {
      expect(boundsFor([])).toEqual({
        maxSpeed: 1024,
        minPing: 50,
        maxPing: 1000,
      });
    });
  });

  describe('qualityRank', () => {
    it('orders the tiers', () => {
      const r = (q: string) =>
        qualityRank({ quality: q, loadSpeed: '', pingTime: 0 });
      expect(r('4K')).toBeGreaterThan(r('2K'));
      expect(r('2K')).toBeGreaterThan(r('1080p'));
      expect(r('1080p')).toBeGreaterThan(r('720p'));
      expect(r('720p')).toBeGreaterThan(r('SD'));
    });

    it('sorts unknown quality last', () => {
      expect(
        qualityRank({ quality: '未知', loadSpeed: '', pingTime: 0 })
      ).toBeLessThan(0);
    });
  });

  describe('measureSource input guard', () => {
    // Regression: a source with no episode for the requested index yields ''.
    // fetch('') requests the current page, the HTML parses as a playlist with
    // no RESOLUTION, and the result is a *non-error* metric that can win the
    // ranking. Fail fast instead.
    it.each(['', '   ', 'not-a-url', '/relative/path.m3u8', 'javascript:x'])(
      'rejects %j without issuing a request',
      async (bad) => {
        const g = globalThis as unknown as {
          fetch: jest.Mock;
          localStorage: Storage;
        };
        const originalFetch = globalThis.fetch;
        const originalLocal = globalThis.localStorage;
        g.fetch = jest.fn();
        g.localStorage = {
          getItem: jest.fn(() => null),
          setItem: jest.fn(),
        } as unknown as Storage;

        try {
          const r = await measureSource(bad);
          expect(r.hasError).toBe(true);
          expect(g.fetch).not.toHaveBeenCalled();
        } finally {
          globalThis.fetch = originalFetch;
          globalThis.localStorage = originalLocal;
        }
      }
    );

    it('does not consult the cache for an invalid url', async () => {
      // Seed the cache with a poisoned entry under the empty-string key; if the
      // guard ran after the cache lookup this would be returned instead of an
      // error, which is exactly the failure mode we're guarding against.
      const g = globalThis as unknown as {
        localStorage: {
          setItem: (k: string, v: string) => void;
          getItem: (k: string) => string | null;
        };
      };
      g.localStorage.setItem(
        'moontv_source_metrics',
        JSON.stringify({
          version: '1',
          entries: {
            '': {
              at: Date.now(),
              metrics: { quality: '4K', loadSpeed: '999 MB/s', pingTime: 1 },
            },
          },
        })
      );
      const r = await measureSource('');
      expect(r.hasError).toBe(true);
      expect(r.quality).not.toBe('4K');
    });
  });

  describe('decideSuggestion', () => {
    const cur = { quality: '720p', loadSpeed: '1024 KB/s', pingTime: 50 };

    it('declines when the challenger is the current source', () => {
      expect(decideSuggestion(cur, cur, true).suggest).toBe(false);
    });

    it('offers a faster source when the score lead is decisive', () => {
      const d = decideSuggestion(
        { quality: '720p', loadSpeed: '4.0 MB/s', pingTime: 50 },
        cur,
        false,
        95,
        50
      );
      expect(d.suggest).toBe(true);
      expect(d.reason).toBe('faster');
    });

    it('declines a faster source whose score lead is too small', () => {
      // 2x throughput but the same resolution tier, and the normalised scores
      // barely separate -> not worth interrupting the user.
      const d = decideSuggestion(
        { quality: '720p', loadSpeed: '4.0 MB/s', pingTime: 50 },
        cur,
        false,
        84,
        80
      );
      expect(d.suggest).toBe(false);
      expect(d.reason).toBe('not-better');
    });

    it('offers a quality upgrade even when the score gap is under the threshold', () => {
      // Regression: a 720p->1080p bump is worth 0.4 * (75-60) = 6 points, below
      // MIN_SUGGEST_GAP (12). Gating every reason on the gap silently vetoed
      // every quality upgrade whenever speed and latency tied.
      const d = decideSuggestion(
        { quality: '1080p', loadSpeed: '1024 KB/s', pingTime: 50 },
        cur,
        false,
        90,
        84
      );
      expect(d.suggest).toBe(true);
      expect(d.reason).toBe('quality-upgrade');
    });

    it('offers a higher resolution source even at the same speed', () => {
      // This is the case a speed-only gate would miss: on a fast connection a
      // 4K source is exactly when the user wants to be told.
      const d = decideSuggestion(
        { quality: '4K', loadSpeed: '1024 KB/s', pingTime: 50 },
        cur,
        false,
        100,
        84
      );
      expect(d.suggest).toBe(true);
      expect(d.reason).toBe('quality-upgrade');
    });

    it('declines a strictly worse source', () => {
      const d = decideSuggestion(
        { quality: 'SD', loadSpeed: '256 KB/s', pingTime: 50 },
        cur,
        false
      );
      expect(d.suggest).toBe(false);
      expect(d.reason).toBe('not-better');
    });

    it('treats a speed difference inside the noise band as not-better', () => {
      // 1100 vs 1024 KB/s is +7.6%, below the 1.3x threshold
      const d = decideSuggestion(
        { quality: '720p', loadSpeed: '1100 KB/s', pingTime: 50 },
        cur,
        false
      );
      expect(d.suggest).toBe(false);
    });

    it('never offers a quality downgrade as a quality upgrade', () => {
      const d = decideSuggestion(
        { quality: 'SD', loadSpeed: '8.0 MB/s', pingTime: 50 },
        cur,
        false,
        99,
        84
      );
      expect(d.reason).not.toBe('quality-upgrade');
    });

    it('does not push a faster-but-coarser source at a modest lead', () => {
      // SD vs 720p: quality costs 40 * (60-20) = 16 points, so even an 8x
      // throughput win only just clears the threshold. Pushing SD at someone
      // watching 720p is not an improvement, so this stays declined.
      const d = decideSuggestion(
        { quality: 'SD', loadSpeed: '8.0 MB/s', pingTime: 50 },
        cur,
        false,
        95,
        84
      );
      expect(d.suggest).toBe(false);
    });
  });
});
