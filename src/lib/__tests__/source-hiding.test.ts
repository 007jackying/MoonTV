import { toPublicApiSites } from '../config';
import { applyDoubanProxy, resolveDoubanProxy } from '../douban';

describe('toPublicApiSites', () => {
  it('drops upstream api / detail urls', () => {
    const out = toPublicApiSites([
      {
        key: 'a',
        name: 'A',
        api: 'https://secret.example/api.php/provide/vod',
        detail: 'https://secret.example',
        is_adult: false,
      },
    ]);
    expect(out).toEqual([{ key: 'a', name: 'A', is_adult: false }]);
    expect(JSON.stringify(out)).not.toContain('secret.example');
  });
});

describe('applyDoubanProxy', () => {
  const url = 'https://m.douban.com/rexxar/api/v2/movie/recommend?start=0';

  it('leaves direct requests untouched', () => {
    expect(applyDoubanProxy(url)).toBe(url);
    expect(applyDoubanProxy(url, { type: 'direct', url: '' })).toBe(url);
  });

  it('rewrites hosts for the CMLiussss mirrors', () => {
    expect(
      applyDoubanProxy(url, { type: 'cmliussss-cdn-tencent', url: '' })
    ).toBe(
      'https://m.douban.cmliussss.net/rexxar/api/v2/movie/recommend?start=0'
    );
    expect(
      applyDoubanProxy('https://movie.douban.com/j/x', {
        type: 'cmliussss-cdn-ali',
        url: '',
      })
    ).toBe('https://movie.douban.cmliussss.com/j/x');
  });

  it('prefixes proxy urls', () => {
    expect(applyDoubanProxy(url, { type: 'cors-proxy-zwei', url: '' })).toBe(
      `https://ciao-cors.is-an.org/${encodeURIComponent(url)}`
    );
    expect(
      applyDoubanProxy(url, { type: 'custom', url: 'https://p.example/?u=' })
    ).toBe(`https://p.example/?u=${encodeURIComponent(url)}`);
  });
});

describe('resolveDoubanProxy', () => {
  it('accepts preset proxies from the request', async () => {
    const params = new URLSearchParams('proxy=cmliussss-cdn-ali');
    expect(await resolveDoubanProxy(params)).toEqual({
      type: 'cmliussss-cdn-ali',
      url: '',
    });
  });

  it('never takes a custom proxy url from the request', async () => {
    const params = new URLSearchParams(
      'proxy=custom&proxyUrl=http://169.254.169.254/'
    );
    const proxy = await resolveDoubanProxy(params);
    expect(proxy.url).not.toContain('169.254.169.254');
  });
});
