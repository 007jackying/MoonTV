import {
  formatEpisodeLabel,
  MESSAGES,
  optionLabel,
  shortEpisodeLabel,
} from '@/lib/i18n';
import { filterAdsFromM3U8, formatClock, isHlsUrl } from '@/lib/player/engine';

describe('player engine helpers', () => {
  it('removes ad segments, not just the discontinuity markers (rules in adFilter.test.ts)', () => {
    const content = (from: number) =>
      Array.from({ length: 10 }, (_, i) => [
        '#EXTINF:4,',
        `${String(from + i).padStart(4, '0')}.ts`,
      ]).flat();
    const m3u8 = [
      '#EXTM3U',
      ...content(0),
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:4,',
      'https://ad.example.com/x/ad.ts',
      '#EXT-X-DISCONTINUITY',
      ...content(10),
    ].join('\n');
    const out = filterAdsFromM3U8(m3u8, 'https://v.example.com/hls/index.m3u8');
    expect(out).not.toContain('ad.ts');
    // 正片两段之间的标记保留
    expect(out.match(/#EXT-X-DISCONTINUITY/g)).toHaveLength(1);
    expect(filterAdsFromM3U8('')).toBe('');
  });

  it('formats clock without rounding up to :60', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(59.9)).toBe('00:59');
    expect(formatClock(842)).toBe('14:02');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(NaN)).toBe('00:00');
    expect(formatClock(-5)).toBe('00:00');
  });

  it('detects HLS urls', () => {
    expect(isHlsUrl('https://x/y/index.m3u8')).toBe(true);
    expect(isHlsUrl('https://x/y/index.m3u8?token=1')).toBe(true);
    expect(isHlsUrl('https://x/y/movie.mp4')).toBe(false);
  });
});

describe('i18n helpers', () => {
  it('formats episode labels', () => {
    expect(formatEpisodeLabel(MESSAGES.zh, '第06集', 5)).toBe('第 6 集');
    expect(formatEpisodeLabel(MESSAGES.en, '06', 5)).toBe('Episode 6');
    expect(formatEpisodeLabel(MESSAGES.en, undefined, 2)).toBe('Episode 3');
    expect(formatEpisodeLabel(MESSAGES.zh, 'HD中字', 0)).toBe('HD中字');
  });

  it('shortens tile labels', () => {
    expect(shortEpisodeLabel('第12集', 0)).toBe('12');
    expect(shortEpisodeLabel('03', 0)).toBe('3');
    expect(shortEpisodeLabel('上', 0)).toBe('上');
    expect(shortEpisodeLabel(undefined, 4)).toBe('5');
  });

  it('translates douban option labels only in English', () => {
    expect(optionLabel('zh', '最近热门')).toBe('最近热门');
    expect(optionLabel('en', '最近热门')).toBe('Trending');
    expect(optionLabel('en', '90年代')).toBe('1990s');
    expect(optionLabel('en', '2010年代')).toBe('2010s');
    expect(optionLabel('en', '未知分类')).toBe('未知分类');
  });

  it('has the same keys in both languages', () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(
      Object.keys(MESSAGES.zh).sort()
    );
  });
});
