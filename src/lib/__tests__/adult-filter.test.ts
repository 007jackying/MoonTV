import {
  ADULT_FILTER_PARAM,
  DEFAULT_FILTER_ADULT_SOURCES,
  filterAdultSources,
  isAdultSource,
  parseAdultFilterParam,
} from '../adult-filter';

const toParams = (query: string) => new URLSearchParams(query);

describe('isAdultSource', () => {
  it('按 AV- 前缀识别成人源', () => {
    expect(isAdultSource({ name: 'AV-155资源' })).toBe(true);
    expect(isAdultSource({ name: 'av_AIfav' })).toBe(true);
    expect(isAdultSource({ name: 'AV 森林资源' })).toBe(true);
  });

  it('尊重 config.json 的 is_adult 标记', () => {
    expect(isAdultSource({ name: '细胞采集黄色', is_adult: true })).toBe(true);
    expect(isAdultSource({ name: 'AV-155资源', is_adult: false })).toBe(true);
  });

  it('不误伤普通源', () => {
    expect(isAdultSource({ name: 'AVPlayer' })).toBe(false);
    expect(isAdultSource({ name: '量子资源' })).toBe(false);
    expect(isAdultSource({ name: 'AV' })).toBe(false);
    expect(isAdultSource({ name: '', is_adult: false })).toBe(false);
    expect(isAdultSource(undefined)).toBe(false);
  });
});

describe('filterAdultSources', () => {
  it('剔除 AV 源并保持其余顺序', () => {
    const sites = [
      { key: 'a', name: '量子资源' },
      { key: 'b', name: 'AV-155资源' },
      { key: 'c', name: '黄色资源啊啊', is_adult: true },
      { key: 'd', name: '非凡资源' },
    ];
    expect(filterAdultSources(sites).map((s) => s.key)).toEqual(['a', 'd']);
  });
});

describe('parseAdultFilterParam', () => {
  it('缺省时不过滤，兼容 OrionTV / TVBox 等外部调用方', () => {
    expect(parseAdultFilterParam(toParams(''))).toBe(false);
  });

  it('识别开启与关闭', () => {
    expect(parseAdultFilterParam(toParams(`${ADULT_FILTER_PARAM}=1`))).toBe(
      true
    );
    expect(parseAdultFilterParam(toParams(`${ADULT_FILTER_PARAM}=true`))).toBe(
      true
    );
    expect(parseAdultFilterParam(toParams(`${ADULT_FILTER_PARAM}=0`))).toBe(
      false
    );
    expect(parseAdultFilterParam(toParams(`${ADULT_FILTER_PARAM}=false`))).toBe(
      false
    );
  });
});

describe('默认值', () => {
  it('过滤开关默认开启', () => {
    expect(DEFAULT_FILTER_ADULT_SOURCES).toBe(true);
  });
});
