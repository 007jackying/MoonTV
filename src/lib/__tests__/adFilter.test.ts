import { MAX_AD_GROUP_SECONDS, removeAdsFromM3U8 } from '@/lib/player/adFilter';

const BASE = 'https://v.example.com/20260101/abc/2000k/hls/index.m3u8';
const D = '#EXT-X-DISCONTINUITY';

type Part = string[] | 'D' | { dur: number[]; names?: string[] };

/** 拼一个媒体播放列表；字符串数组为切片名（每片 4 秒），'D' 为 #EXT-X-DISCONTINUITY */
function playlist(parts: Part[], header: string[] = []): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:8',
    ...header,
  ];
  for (const p of parts) {
    if (p === 'D') lines.push(D);
    else if (Array.isArray(p)) {
      for (const seg of p) lines.push('#EXTINF:4.000,', seg);
    } else {
      p.dur.forEach((d, i) =>
        lines.push(`#EXTINF:${d},`, p.names?.[i] ?? `x${i}.ts`)
      );
    }
  }
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}

function seq(prefix: string, from: number, to: number, pad = 4, ext = '.ts') {
  const out: string[] = [];
  for (let i = from; i <= to; i++) {
    out.push(`${prefix}${String(i).padStart(pad, '0')}${ext}`);
  }
  return out;
}

const segmentsOf = (m3u8: string) =>
  m3u8.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
const tagCount = (m3u8: string) =>
  m3u8.split('\n').filter((l) => l.trim() === D).length;

describe('removeAdsFromM3U8: what is removed', () => {
  it('removes a mid-roll ad served from another path and keeps the tag between the content blocks', () => {
    const { playlist: out, removed } = removeAdsFromM3U8(
      playlist([
        seq('', 0, 20),
        'D',
        ['https://ad.example.com/x/ad1.ts', 'https://ad.example.com/x/ad2.ts'],
        'D',
        seq('', 21, 40),
      ]),
      BASE
    );
    expect(segmentsOf(out)).toEqual(seq('', 0, 40));
    // 正片两组的时间戳可能不连续，标记必须留着（旧实现删掉它会卡死或丢正片）
    expect(tagCount(out)).toBe(1);
    expect(removed).toEqual([
      { group: 1, segments: 2, seconds: 8, reason: 'path' },
    ]);
  });

  it('removes a pre-roll ad without leaving a leading discontinuity', () => {
    const { playlist: out, removed } = removeAdsFromM3U8(
      playlist([['/ads/a1.ts', '/ads/a2.ts'], 'D', seq('', 0, 40)]),
      BASE
    );
    expect(segmentsOf(out)).toEqual(seq('', 0, 40));
    expect(tagCount(out)).toBe(0);
    expect(removed.map((r) => r.reason)).toEqual(['path']);
  });

  it('removes an ad with the same path but a different naming pattern', () => {
    const { playlist: out, removed } = removeAdsFromM3U8(
      playlist([
        seq('8f2e1a', 0, 20, 6),
        'D',
        seq('c9b7d4', 0, 3, 6),
        'D',
        seq('8f2e1a', 21, 40, 6),
      ]),
      BASE
    );
    expect(segmentsOf(out)).toEqual(seq('8f2e1a', 0, 40, 6));
    expect(removed.map((r) => r.reason)).toEqual(['naming']);
  });

  it('removes an ad that breaks the segment numbering', () => {
    const { playlist: out, removed } = removeAdsFromM3U8(
      playlist([seq('', 0, 20), 'D', seq('', 900, 903), 'D', seq('', 21, 40)]),
      BASE
    );
    expect(segmentsOf(out)).toEqual(seq('', 0, 40));
    expect(removed.map((r) => r.reason)).toEqual(['sequence']);
  });

  it('removes a 30fps ad from 25fps content by frame rate', () => {
    const content = { dur: [6.48, 3.84, 4, 2.04, 3.92, 4.48, 5.28, 3.8] };
    const { playlist: out, removed } = removeAdsFromM3U8(
      playlist([
        content,
        'D',
        { dur: [5.533, 3.4] },
        'D',
        content,
        'D',
        content,
      ]),
      BASE
    );
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({
      group: 1,
      segments: 2,
      reason: 'frame-rate',
    });
    expect(removed[0].seconds).toBeCloseTo(8.933);
    expect(segmentsOf(out)).toHaveLength(24);
  });

  it('keeps carried tags (key, map) from a removed group', () => {
    const out = removeAdsFromM3U8(
      [
        '#EXTM3U',
        '#EXT-X-TARGETDURATION:4',
        '#EXT-X-KEY:METHOD=AES-128,URI="key.key"',
        '#EXTINF:4,',
        '/ads/a1.ts',
        D,
        ...seq('', 0, 9).flatMap((s) => ['#EXTINF:4,', s]),
        '#EXT-X-ENDLIST',
      ].join('\n'),
      BASE
    ).playlist;
    expect(out).toContain('#EXT-X-KEY:METHOD=AES-128,URI="key.key"');
    expect(out.indexOf('#EXT-X-KEY')).toBeLessThan(out.indexOf('0000.ts'));
    expect(out).not.toContain('a1.ts');
  });

  it('keeps the header, the end tag and the trailing newline in place', () => {
    const src = playlist(
      [seq('', 0, 20), 'D', ['/ads/a1.ts'], 'D', seq('', 21, 40)],
      ['#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-MEDIA-SEQUENCE:0']
    );
    const out = removeAdsFromM3U8(src, BASE).playlist;
    expect(out.startsWith('#EXTM3U\n#EXT-X-VERSION:3')).toBe(true);
    expect(out).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(out.endsWith('#EXT-X-ENDLIST\n')).toBe(true);
  });
});

describe('removeAdsFromM3U8: what is left alone', () => {
  it('returns playlists without ads unchanged, discontinuity tags included', () => {
    const src = playlist([seq('', 0, 20), 'D', seq('', 21, 40)]);
    expect(removeAdsFromM3U8(src, BASE)).toEqual({
      playlist: src,
      removed: [],
    });
  });

  it('returns master playlists unchanged', () => {
    const master =
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n2000k/hls/index.m3u8';
    expect(removeAdsFromM3U8(master, BASE).playlist).toBe(master);
    expect(removeAdsFromM3U8('', BASE).playlist).toBe('');
  });

  it('does not use naming rules when names are random hashes', () => {
    const names = Array.from(
      { length: 30 },
      (_, i) => `${(i * 2654435761).toString(16).padStart(8, 'a')}.ts`
    );
    const src = playlist([
      names.slice(0, 10),
      'D',
      names.slice(10, 12),
      'D',
      names.slice(12),
    ]);
    expect(removeAdsFromM3U8(src, BASE).removed).toEqual([]);
  });

  it('ignores digits that happen to end random hash names', () => {
    const src = playlist([
      ['f05d1645829d33f9d4.ts', '453780c7993e5292a16e0.ts'],
      'D',
      ['e54c4c58749d191d45ff.ts', 'e7c67e21dca36cf8752ad.ts'],
      'D',
      ['c794956470d92f64bc6d72098c8d28c1.ts', 'dc2f9c1440ec8446af1c3.ts'],
    ]);
    expect(segmentsOf(removeAdsFromM3U8(src, BASE).playlist)).toHaveLength(6);
  });

  it(`keeps groups longer than ${MAX_AD_GROUP_SECONDS}s even when they look different`, () => {
    const src = playlist([seq('', 0, 40), 'D', seq('part2_', 0, 40)]);
    expect(removeAdsFromM3U8(src, BASE).removed).toEqual([]);
  });

  it('does not treat CDN host rotation as a different path', () => {
    const names = seq('', 0, 40).map(
      (n, i) =>
        `https://cdn${(i % 3) + 1}.example.com/20260101/abc/2000k/hls/${n}`
    );
    const src = playlist([
      names.slice(0, 20),
      'D',
      names.slice(20, 22),
      'D',
      names.slice(22),
    ]);
    expect(removeAdsFromM3U8(src, BASE).removed).toEqual([]);
  });

  it('does not treat unpadded numbers crossing a digit boundary as a new naming pattern', () => {
    const src = playlist([seq('', 960, 999, 1), 'D', seq('', 1000, 1003, 1)]);
    expect(removeAdsFromM3U8(src, BASE).removed).toEqual([]);
  });

  it('does not flag 30fps-looking groups when the content fits several frame rates', () => {
    // 正片切片都是整数秒，同时落在 25、30、24 fps 网格上：帧率区分不了，不删
    const content = { dur: [4, 4, 4, 4, 4, 4, 4, 4] };
    const src = playlist([content, 'D', { dur: [5.533, 3.4] }, 'D', content]);
    expect(removeAdsFromM3U8(src, BASE).removed).toEqual([]);
  });

  it('gives up rather than remove more than a third of the video', () => {
    const src = playlist([
      seq('', 0, 9),
      'D',
      [
        '/ads/1.ts',
        '/ads/2.ts',
        '/ads/3.ts',
        '/ads/4.ts',
        '/ads/5.ts',
        '/ads/6.ts',
      ],
      'D',
      seq('', 10, 13),
    ]);
    // 6 / 20 段 < 1/3：删
    expect(removeAdsFromM3U8(src, BASE).removed).toHaveLength(1);
    const tooMuch = playlist([
      seq('', 0, 9),
      'D',
      seq('/ads/', 0, 5),
      'D',
      seq('/ads/', 6, 11),
    ]);
    expect(removeAdsFromM3U8(tooMuch, BASE)).toEqual({
      playlist: tooMuch,
      removed: [],
    });
  });

  it('does not mistake #EXT-X-DISCONTINUITY-SEQUENCE for a discontinuity', () => {
    const src = playlist(
      [seq('', 0, 20), 'D', ['/ads/a.ts'], 'D', seq('', 21, 40)],
      ['#EXT-X-DISCONTINUITY-SEQUENCE:3']
    );
    const out = removeAdsFromM3U8(src, BASE).playlist;
    expect(out).toContain('#EXT-X-DISCONTINUITY-SEQUENCE:3');
    expect(segmentsOf(out)).toEqual(seq('', 0, 40));
  });
});

// ---------------------------------------------------------------------------
// 真实片源数据：时长取自各资源站真实播放列表，广告分组已抽帧确认。
// 数据来源 Chongjian528/MoonTV（MIT）src/lib/m3u8.test.ts
// ---------------------------------------------------------------------------

/** 按分组时长拼播放列表，切片名为随机哈希；返回每组的切片名 */
function grouped(groups: number[][], leadingTag = false) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:8'];
  let n = 0;
  const names = groups.map((g, i) => {
    if (i > 0 || leadingTag) lines.push(D);
    return g.map((d) => {
      const name = `${(++n * 2654435761)
        .toString(16)
        .padStart(32, 'f')}.ts?hash=${n}`;
      lines.push(`#EXTINF:${d.toFixed(3)},`, name);
      return name;
    });
  });
  lines.push('#EXT-X-ENDLIST');
  return { m3u8: lines.join('\n'), names };
}

function expectRemoved(groups: number[][], ads: number[]) {
  const { m3u8, names } = grouped(groups);
  const { playlist: out, removed } = removeAdsFromM3U8(m3u8, BASE);
  expect(removed.map((r) => r.group)).toEqual(ads);
  expect(segmentsOf(out)).toEqual(
    names.filter((_, i) => !ads.includes(i)).flat()
  );
  return removed;
}

// 非凡（ffzy）一集的全部分组：正片 25fps（切片是 0.04 的整数倍），约每 20 秒一个
// #EXT-X-DISCONTINUITY；第 21、22、58、59 组是 30fps 的插播广告
const FFZY_GROUPS: number[][] = [
  [6.48, 4, 4, 4, 4],
  [3.84, 4, 2.04, 3.92, 4.48],
  [3.36, 4.56, 5.4, 3.16, 2.88],
  [5.28, 3.8, 4.6, 2.96, 4.2],
  [6.16, 2.04, 4.08, 4, 4.28],
  [2.88, 4.68, 3.84, 3.68, 5],
  [4, 3.92, 4, 4, 4],
  [3.8, 4, 4.8, 2.24, 5.6],
  [2.32, 4.08, 3.88, 6.04, 4],
  [3.36, 3.24, 3.2, 4.28, 3.64],
  [5.4, 5.2, 2.12, 4.36, 4.44],
  [3.2, 4, 5.2, 2.12, 7.08],
  [3.12, 2.88, 4.04, 3.6, 4.16],
  [3.2, 5.72, 3.92, 4.12, 2.32],
  [5.6, 2.36, 3.88, 4.28, 4.32],
  [4.2, 3.36, 5.68, 2.56, 3.64],
  [5.28, 3.32, 3.48, 4.88, 3],
  [4.04, 4.24, 6.88, 1.04, 4.16],
  [4.56, 3.76, 4.16, 4, 4.56],
  [3.36, 4.68, 2.68, 4.04, 6.36],
  [2.16, 3.28, 4.24, 3.88],
  [5.567, 3.2],
  [5.367, 3.333, 1.6],
  [4.36, 6.56, 1.36, 4, 4.8],
  [2.96, 7.28, 1.88, 4, 4],
  [4, 3.12, 4.52, 3.88, 4],
  [4, 5.04, 3.32, 3.36, 3.96],
  [4.8, 3.84, 4.68, 2.52, 4.72],
  [3.36, 4, 4, 5.6, 2.32],
  [3.76, 4.92, 4.16, 6.4, 4],
  [0.88, 3.88, 6.56, 1.64, 4.4],
  [
    3.52, 3.64, 7.48, 0.76, 3.76, 4.64, 3.96, 4.76, 5.6, 2.2, 5.12, 1.8, 4.72,
    5.48, 4, 1.6, 4.68, 4.32, 4.8, 2.36, 4.12, 5, 3.88, 3.96, 4.72, 3.68, 3.64,
    5.08, 1.8, 6, 2.92, 3.08, 6.56, 4, 4, 1.92, 5.44, 2.04, 4.12, 7.28,
  ],
  [2.08, 3.24, 4.28, 4.64, 3.88],
  [3.96, 2.56, 3.96, 5.24, 4],
  [5.64, 2.36, 4.96, 3.52, 3.72],
  [2.92, 5.76, 2.04, 5.8, 2.08],
  [5.16, 3, 4.96, 2.96, 5.4],
  [4.24, 2.44, 5.96, 5.6, 0.88, 4.32, 4.2, 3, 6.2, 1.68],
  [4.04, 4.96, 3.16, 4.12, 4.96],
  [4.32, 6, 0.72, 4.84, 4.12],
  [2.72, 4.76, 4.68, 2.76, 4.28],
  [6.12, 1.72, 4.36, 5.36, 3.2],
  [3.36, 3.72, 4.92, 3.48, 6.28],
  [
    2.56, 3.24, 3.4, 5.08, 4.36, 3.72, 2.64, 7.44, 3.92, 3.12, 2.28, 4.6, 6.12,
    1.72, 3.4, 4.64, 3.96, 2.96, 6.8, 3.12,
  ],
  [3.12, 3.72, 4.04, 5.52, 2.64],
  [
    2.96, 7, 1.44, 4.96, 3.56, 4.32, 5.88, 3.96, 1.16, 4.84, 3.16, 6.28, 1.52,
    5.36, 5.4, 2.2, 4.04, 4.04, 3.04, 4.72, 4.64, 3.36, 3.24, 4.96, 4.52, 2.64,
    3.8, 4.52, 5.44, 5.76,
  ],
  [1.48, 2.84, 4.12, 3.92, 4.12],
  [4.32, 4.44, 3.32, 3.96, 6.48, 2.68, 3.72, 4.28, 2.92, 5.72],
  [4.6, 3.12, 2.72, 4, 4.84],
  [2.56, 4.28, 4.32, 6.48, 4],
  [4.12, 3.6, 4, 2.12, 6.44],
  [2.32, 4, 4.76, 2.24, 4],
  [
    4, 4.96, 3.96, 2.76, 4.6, 6.24, 4, 3.08, 3.24, 2.64, 5.08, 3.4, 4, 5.36,
    3.56,
  ],
  [5.92, 3, 4.68, 4, 4],
  [1.28, 6.64, 2.92, 2.56, 5.4],
  [3, 4, 4, 4, 4],
  [4, 4, 4, 4, 4],
  [4, 4, 4, 4, 4],
  [6.667, 2.133],
  [3.233, 3.733],
  [4, 4, 4, 4, 3.6],
];
const FFZY_ADS = [21, 22, 58, 59];

describe('removeAdsFromM3U8 on real source data', () => {
  it('非凡: removes the four 30fps ad groups and keeps every content segment', () => {
    const { m3u8, names } = grouped(FFZY_GROUPS, true);
    const { playlist: out, removed } = removeAdsFromM3U8(m3u8, BASE);
    expect(removed.map((r) => r.group)).toEqual(FFZY_ADS);
    expect(segmentsOf(out)).toEqual(
      names.filter((_, i) => !FFZY_ADS.includes(i)).flat()
    );
    // 57 组正片之间各留一个标记，开头不留
    expect(tagCount(out)).toBe(FFZY_GROUPS.length - FFZY_ADS.length - 1);
    expect(out.split('\n').slice(0, 4)).not.toContain(D);
  });

  // 30fps 正片：帧率规则区分不了，只能靠指纹
  const content30 = [
    [4.2, 4.6, 3.5, 4.167, 3.767],
    [4.9, 3.7, 4.467, 3.333, 4.833],
    [2.833, 5.333, 3.1, 3.333, 4.933],
    [3.333, 3.967, 4.067, 4.8, 3.533],
  ];

  it('电影天堂: removes known ads inside 30fps content', () => {
    const removed = expectRemoved(
      [
        ...content30.slice(0, 2),
        [5.567, 3.2],
        [5.367, 3.333, 1.6],
        ...content30.slice(2),
        [6.667],
        [2.133, 3.233, 3.733],
        content30[0],
      ],
      [2, 3, 6, 7]
    );
    expect(new Set(removed.map((r) => r.reason))).toEqual(
      new Set(['fingerprint'])
    );
  });

  it('如意: removes known ads inside 25fps content', () => {
    const content25 = [
      [4.0, 4.0, 7.04, 4.0, 4.0, 2.4],
      [5.12, 4.0, 4.68, 1.16, 4.0, 4.0],
      [3.96, 4.0, 3.72, 4.0, 2.48, 4.0],
    ];
    // 正片组多放几组，让广告占比接近真实的一集（否则会触发 1/3 的保护上限）
    expectRemoved(
      [
        ...content25,
        [4.0, 5.48, 2.92, 4.0, 4.32, 1.28],
        ...content25.slice(0, 2),
        [4.0, 4.0, 4.0, 4.0, 4.0, 1.0],
        ...content25,
      ],
      [3, 6]
    );
  });

  it('量子: removes the ad inside 23.976fps content', () => {
    const content = [4.004, 3.337, 4.004, 2.436, 4.004, 3.337, 4.004, 4.004];
    expectRemoved(
      [content, content, [4, 4, 4, 4, 4, 4, 1.7], content, content],
      [2]
    );
  });

  it('does not match a short fingerprint on its own', () => {
    expectRemoved([...content30.slice(0, 2), [6.667], content30[2]], []);
  });
});
