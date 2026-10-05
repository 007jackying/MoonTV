import { SourceMetrics } from '@/lib/source-metrics';
import { SearchResult } from '@/lib/types';

import {
  pickFailoverSource,
  rankSources,
} from '@/components/play/sourceHealth';

const src = (name: string, episodes = 1) =>
  ({
    source: name,
    id: `${name}-1`,
    title: 'T',
    source_name: name,
    episodes: Array.from(
      { length: episodes },
      (_, i) => `https://${name}.example/ep${i + 1}.m3u8`
    ),
  } as unknown as SearchResult);

const ok = (loadSpeed: string, pingTime = 100): SourceMetrics => ({
  quality: '1080p',
  loadSpeed,
  pingTime,
});
const broken: SourceMetrics = {
  quality: '未知',
  loadSpeed: '未知',
  pingTime: 0,
  hasError: true,
};

const keyOf = (name: string) => `${name}-${name}-1`;
const names = (list: SearchResult[]) => list.map((s) => s.source);

describe('rankSources', () => {
  it('puts tested sources first by score, then untested, errored, failed', () => {
    const sources = ['a', 'b', 'c', 'd', 'e'].map((n) => src(n));
    const infoMap = new Map([
      [keyOf('a'), broken],
      [keyOf('c'), ok('300 KB/s', 400)],
      [keyOf('d'), ok('2.0 MB/s', 100)],
      [keyOf('e'), ok('1.0 MB/s', 100)],
    ]);
    const ranked = rankSources(sources, infoMap, new Set([keyOf('e')]));
    expect(names(ranked)).toEqual(['d', 'c', 'b', 'a', 'e']);
  });

  it('keeps the original order within a tier', () => {
    const sources = ['a', 'b', 'c'].map((n) => src(n));
    expect(names(rankSources(sources, new Map(), new Set()))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('pickFailoverSource', () => {
  const base = {
    currentKey: keyOf('cur'),
    episodeIndex: 0,
    failedKeys: new Set([keyOf('cur')]),
    speedTestEnabled: true,
    searchLoading: false,
  };

  it('switches to the best tested source, skipping errored ones', () => {
    const decision = pickFailoverSource({
      ...base,
      sources: ['cur', 'bad', 'slow', 'fast'].map((n) => src(n)),
      infoMap: new Map([
        [keyOf('bad'), broken],
        [keyOf('slow'), ok('200 KB/s', 900)],
        [keyOf('fast'), ok('3.0 MB/s', 80)],
      ]),
    });
    expect(decision).toEqual({ kind: 'switch', source: src('fast') });
  });

  it('waits while candidates are still being measured', () => {
    const decision = pickFailoverSource({
      ...base,
      sources: ['cur', 'bad', 'pending'].map((n) => src(n)),
      infoMap: new Map([[keyOf('bad'), broken]]),
    });
    expect(decision).toEqual({ kind: 'wait' });
  });

  it('picks the next untested source in order when speed tests are off', () => {
    const decision = pickFailoverSource({
      ...base,
      speedTestEnabled: false,
      sources: ['cur', 'x', 'y'].map((n) => src(n)),
      infoMap: new Map(),
    });
    expect(decision).toEqual({ kind: 'switch', source: src('x') });
  });

  it('waits for the search to finish before falling back to errored sources', () => {
    const args = {
      ...base,
      sources: ['cur', 'bad'].map((n) => src(n)),
      infoMap: new Map([[keyOf('bad'), broken]]),
    };
    expect(pickFailoverSource({ ...args, searchLoading: true })).toEqual({
      kind: 'wait',
    });
    expect(pickFailoverSource(args)).toEqual({
      kind: 'switch',
      source: src('bad'),
    });
  });

  it('never retries a source that already failed in the player', () => {
    const decision = pickFailoverSource({
      ...base,
      failedKeys: new Set([keyOf('cur'), keyOf('other')]),
      sources: ['cur', 'other'].map((n) => src(n)),
      infoMap: new Map([[keyOf('other'), ok('5.0 MB/s')]]),
    });
    expect(decision).toEqual({ kind: 'exhausted' });
  });

  it('ignores sources without any episode url', () => {
    const decision = pickFailoverSource({
      ...base,
      sources: [src('cur'), src('empty', 0)],
      infoMap: new Map(),
    });
    expect(decision).toEqual({ kind: 'exhausted' });
  });
});
