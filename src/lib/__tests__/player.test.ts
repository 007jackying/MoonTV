import {
  formatEpisodeLabel,
  MESSAGES,
  optionLabel,
  shortEpisodeLabel,
} from '@/lib/i18n';
import {
  lowerBound,
  parseDanmakuJson,
  parseDanmakuXml,
} from '@/lib/player/danmaku';
import { filterAdsFromM3U8, formatClock, isHlsUrl } from '@/lib/player/engine';

describe('player engine helpers', () => {
  it('removes discontinuity markers used by ad splices', () => {
    const m3u8 = [
      '#EXTM3U',
      '#EXTINF:4,',
      'a.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:4,',
      'ad.ts',
    ].join('\n');
    expect(filterAdsFromM3U8(m3u8)).not.toContain('DISCONTINUITY');
    expect(filterAdsFromM3U8(m3u8)).toContain('ad.ts');
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

describe('danmaku parsing', () => {
  it('parses bilibili xml with modes, colors and entities', () => {
    const xml =
      '<i><d p="3.5,1,25,16777215,0,0,0,1">hello &amp; bye</d>' +
      '<d p="1.0,5,25,16711680,0,0,0,2">top</d>' +
      '<d p="2.0,4,25,255,0,0,0,3">bottom</d></i>';
    const items = parseDanmakuXml(xml);
    expect(items.map((d) => d.time)).toEqual([1, 2, 3.5]);
    expect(items[0]).toMatchObject({ mode: 1, color: '#ff0000', text: 'top' });
    expect(items[1]).toMatchObject({ mode: 2, color: '#0000ff' });
    expect(items[2]).toMatchObject({
      mode: 0,
      color: '#ffffff',
      text: 'hello & bye',
    });
  });

  it('parses dandanplay json', () => {
    const items = parseDanmakuJson({
      comments: [
        { p: '2.5,1,16777215,u', m: 'x' },
        { p: '1,5,0,u', m: 'y' },
      ],
    });
    expect(items.map((d) => d.text)).toEqual(['y', 'x']);
  });

  it('binary searches by time', () => {
    const items = parseDanmakuXml(
      '<i><d p="1,1,25,0">a</d><d p="2,1,25,0">b</d><d p="3,1,25,0">c</d></i>'
    );
    expect(lowerBound(items, 0)).toBe(0);
    expect(lowerBound(items, 2)).toBe(1);
    expect(lowerBound(items, 2.5)).toBe(2);
    expect(lowerBound(items, 9)).toBe(3);
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
