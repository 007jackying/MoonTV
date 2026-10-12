import { parseDoubanEpisodes } from '../douban-episodes';

describe('parseDoubanEpisodes', () => {
  it('reads the episode count from douban episodes_info', () => {
    expect(parseDoubanEpisodes('更新至12集')).toBe(12);
    expect(parseDoubanEpisodes('全24集')).toBe(24);
    expect(parseDoubanEpisodes('12集全')).toBe(12);
    expect(parseDoubanEpisodes('共 8 集')).toBe(8);
  });

  it('returns undefined when there is no count', () => {
    expect(parseDoubanEpisodes('')).toBeUndefined();
    expect(parseDoubanEpisodes(undefined)).toBeUndefined();
    expect(parseDoubanEpisodes(null)).toBeUndefined();
    expect(parseDoubanEpisodes('已完结')).toBeUndefined();
    expect(parseDoubanEpisodes('0集')).toBeUndefined();
  });
});
