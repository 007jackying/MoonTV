import {
  doubanAbstractUrl,
  normalizeDoubanRate,
  parseDoubanRate,
} from '@/lib/douban-rating';

describe('douban rating', () => {
  it('parses subject_abstract responses', () => {
    expect(parseDoubanRate({ r: 0, subject: { rate: '7.5' } })).toBe('7.5');
    expect(parseDoubanRate({ subject: { rate: '8' } })).toBe('8.0');
  });

  it('parses rexxar responses', () => {
    expect(parseDoubanRate({ rating: { value: 9.24, max: 10 } })).toBe('9.2');
  });

  it('returns null for unrated or malformed responses', () => {
    expect(parseDoubanRate({ subject: { rate: '' } })).toBeNull();
    expect(parseDoubanRate({ rating: { value: 0 } })).toBeNull();
    expect(parseDoubanRate({ rating: null })).toBeNull();
    expect(parseDoubanRate(null)).toBeNull();
    expect(parseDoubanRate('oops')).toBeNull();
  });

  it('rejects out-of-range values', () => {
    expect(normalizeDoubanRate('11')).toBeNull();
    expect(normalizeDoubanRate(-1)).toBeNull();
    expect(normalizeDoubanRate('abc')).toBeNull();
  });

  it('builds the abstract URL on a mirror host', () => {
    expect(doubanAbstractUrl(123, 'movie.douban.cmliussss.net')).toBe(
      'https://movie.douban.cmliussss.net/j/subject_abstract?subject_id=123'
    );
  });
});
