import { act, renderHook, waitFor } from '@testing-library/react';

import { SourceMetrics } from '@/lib/source-metrics';
import { SearchResult } from '@/lib/types';

import {
  measurableCurrentFirst,
  useSourceSpeedTest,
} from '@/components/play/useSourceSpeedTest';

const pending = new Map<string, (m: SourceMetrics) => void>();
const measureSource = jest.fn(
  (url: string) =>
    new Promise<SourceMetrics>((resolve) => pending.set(url, resolve))
);

jest.mock('@/lib/source-metrics', () => ({
  ...jest.requireActual('@/lib/source-metrics'),
  measureSource: (url: string) => measureSource(url),
}));

const source = {
  source: 'fast',
  id: 'fast-1',
  title: 'T',
  source_name: 'Fast',
  episodes: ['https://cdn.example/ep1.m3u8', 'https://cdn.example/ep2.m3u8'],
} as unknown as SearchResult;

const metrics = (quality: string): SourceMetrics => ({
  quality,
  loadSpeed: '1.0 MB/s',
  pingTime: 40,
});

describe('useSourceSpeedTest', () => {
  beforeEach(() => {
    pending.clear();
    measureSource.mockClear();
    localStorage.clear();
  });

  it('reports measuring while a measurement is in flight', async () => {
    const { result } = renderHook(() =>
      useSourceSpeedTest({
        sources: [source],
        current: source,
        testAll: false,
        episodeIndex: 0,
      })
    );

    // The indicator must show while the work is happening, not after it.
    await waitFor(() => expect(result.current.isMeasuring(source)).toBe(true));
    expect(result.current.infoMap.size).toBe(0);

    await act(async () => pending.get(source.episodes[0])?.(metrics('720p')));
    expect(result.current.isMeasuring(source)).toBe(false);
    expect(result.current.infoMap.get('fast-fast-1')?.quality).toBe('720p');
  });

  it('measures the new episode after an episode change', async () => {
    const { result, rerender } = renderHook(
      ({ ep }: { ep: number }) =>
        useSourceSpeedTest({
          sources: [source],
          current: source,
          testAll: false,
          episodeIndex: ep,
        }),
      { initialProps: { ep: 0 } }
    );
    await waitFor(() =>
      expect(measureSource).toHaveBeenCalledWith(source.episodes[0])
    );
    await act(async () => pending.get(source.episodes[0])?.(metrics('720p')));
    expect(result.current.infoMap.get('fast-fast-1')?.quality).toBe('720p');

    rerender({ ep: 1 });
    await waitFor(() =>
      expect(measureSource).toHaveBeenCalledWith(source.episodes[1])
    );
    // Episode 1's numbers must not be shown as episode 2's.
    expect(result.current.infoMap.has('fast-fast-1')).toBe(false);

    await act(async () => pending.get(source.episodes[1])?.(metrics('1080p')));
    expect(result.current.infoMap.get('fast-fast-1')?.quality).toBe('1080p');

    // Going back reuses episode 1's result instead of measuring again.
    rerender({ ep: 0 });
    expect(result.current.infoMap.get('fast-fast-1')?.quality).toBe('720p');
    expect(measureSource).toHaveBeenCalledTimes(2);
  });

  it('merges precomputed results only for the episode they were measured on', async () => {
    const precomputed = {
      episodeIndex: 1,
      info: new Map([['fast-fast-1', metrics('4K')]]),
    };
    const { result, rerender } = renderHook(
      ({ ep }: { ep: number }) =>
        useSourceSpeedTest({
          sources: [source],
          current: null,
          testAll: false,
          precomputed,
          episodeIndex: ep,
        }),
      { initialProps: { ep: 0 } }
    );
    await waitFor(() => expect(result.current).toBeTruthy());
    expect(result.current.infoMap.has('fast-fast-1')).toBe(false);
    rerender({ ep: 1 });
    expect(result.current.infoMap.get('fast-fast-1')?.quality).toBe('4K');
  });
});

describe('measurableCurrentFirst', () => {
  const mk = (key: string, episodes: string[]) =>
    ({ source: key, id: '1', episodes } as unknown as SearchResult);
  const a = mk('a', ['https://x/a1', 'https://x/a2']);
  const b = mk('b', ['https://x/b1']);
  const c = mk('c', []);
  const d = mk('d', ['https://x/d1', 'https://x/d2']);

  it('puts the current source first and keeps the rest in order', () => {
    const out = measurableCurrentFirst([a, b, d], 0, 'd-1');
    expect(out.map((s) => s.source)).toEqual(['d', 'a', 'b']);
  });

  it('drops sources with no address for the episode', () => {
    const out = measurableCurrentFirst([a, b, c, d], 0, 'a-1');
    expect(out.map((s) => s.source)).toEqual(['a', 'b', 'd']);
  });

  it('keeps the original order when the current source is not listed', () => {
    const out = measurableCurrentFirst([a, b, d], 1, 'zzz-1');
    expect(out.map((s) => s.source)).toEqual(['a', 'b', 'd']);
  });
});
