import {
  buildFilename,
  episodeFileTitle,
  episodeNumber,
} from '../download-filename';

describe('episodeNumber', () => {
  it('reads common episode labels and falls back to the position', () => {
    expect(episodeNumber('第03集', 0)).toBe(3);
    expect(episodeNumber('第 12 话', 0)).toBe(12);
    expect(episodeNumber('EP07', 0)).toBe(7);
    expect(episodeNumber('E 9', 0)).toBe(9);
    expect(episodeNumber('05', 0)).toBe(5);
    expect(episodeNumber('HD中字', 4)).toBe(5);
    expect(episodeNumber(undefined, 1)).toBe(2);
  });
});

describe('episodeFileTitle', () => {
  it('zero-pads to at least two digits, more for long series', () => {
    expect(episodeFileTitle('庆余年', '第3集', 2, 46, 'zh')).toBe(
      '庆余年 第03集'
    );
    expect(episodeFileTitle('海贼王', '第7集', 6, 1100, 'zh')).toBe(
      '海贼王 第0007集'
    );
    expect(episodeFileTitle('Show', '3', 2, 10, 'en')).toBe('Show E03');
  });

  it('keeps a non-numeric source title after the number', () => {
    expect(episodeFileTitle('庆余年', '特别篇', 46, 47, 'zh')).toBe(
      '庆余年 第47集 特别篇'
    );
  });

  it('uses just the title for a single-episode movie', () => {
    expect(episodeFileTitle('流浪地球', '正片', 0, 1, 'zh')).toBe('流浪地球');
  });

  it('produces names that sort in episode order', () => {
    const names = Array.from({ length: 12 }, (_, i) =>
      buildFilename(episodeFileTitle('剧', `第${i + 1}集`, i, 12, 'zh'), 'MP4')
    );
    expect([...names].sort()).toEqual(names);
  });
});
