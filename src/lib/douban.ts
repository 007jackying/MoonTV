import { getConfig } from './config';

/**
 * 豆瓣数据源（代理方式）。浏览器端只请求本站 /api/douban/*，由服务端按这里的
 * 设置去访问豆瓣或其镜像，真实上游地址不会出现在浏览器的网络请求里。
 */
export interface DoubanProxy {
  type: string;
  url: string;
}

/** 允许浏览器通过 ?proxy= 选择的预设；自定义代理地址只能由站点配置决定（防 SSRF） */
export const DOUBAN_PROXY_PRESETS = [
  'direct',
  'cors-proxy-zwei',
  'cmliussss-cdn-tencent',
  'cmliussss-cdn-ali',
] as const;

/** 请求带合法预设用预设，否则用站点配置 */
export async function resolveDoubanProxy(
  searchParams: Pick<URLSearchParams, 'get'>
): Promise<DoubanProxy> {
  const requested = searchParams.get('proxy') || '';
  if ((DOUBAN_PROXY_PRESETS as readonly string[]).includes(requested)) {
    return { type: requested, url: '' };
  }
  try {
    const config = await getConfig();
    return {
      type: config.SiteConfig.DoubanProxyType || 'direct',
      url: config.SiteConfig.DoubanProxy || '',
    };
  } catch {
    return { type: 'direct', url: '' };
  }
}

/** 按代理方式改写豆瓣目标地址 */
export function applyDoubanProxy(url: string, proxy?: DoubanProxy): string {
  switch (proxy?.type) {
    case 'cors-proxy-zwei':
      return `https://ciao-cors.is-an.org/${encodeURIComponent(url)}`;
    case 'cmliussss-cdn-tencent':
      return url.replace(
        /^https:\/\/(m|movie)\.douban\.com\//,
        'https://$1.douban.cmliussss.net/'
      );
    case 'cmliussss-cdn-ali':
      return url.replace(
        /^https:\/\/(m|movie)\.douban\.com\//,
        'https://$1.douban.cmliussss.com/'
      );
    case 'custom':
      return proxy.url ? `${proxy.url}${encodeURIComponent(url)}` : url;
    case 'direct':
    default:
      return url;
  }
}

/**
 * 通用的豆瓣数据获取函数
 * @param url 请求的URL
 * @param referer Referer 头，默认 movie.douban.com（rexxar 接口需传 m.douban.com）
 * @param proxy 豆瓣数据源，见 resolveDoubanProxy
 * @returns Promise<T> 返回指定类型的数据
 */
export async function fetchDoubanData<T>(
  url: string,
  referer = 'https://movie.douban.com/',
  proxy?: DoubanProxy
): Promise<T> {
  // 添加超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

  // 设置请求选项，包括信号和头部
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    Referer: referer,
    Accept: 'application/json, text/plain, */*',
  };
  const cookie = process.env.DOUBAN_COOKIE;
  if (cookie) headers['Cookie'] = cookie;

  const fetchOptions = { signal: controller.signal, headers };

  try {
    const response = await fetch(applyDoubanProxy(url, proxy), fetchOptions);
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`豆瓣返回了非 JSON 数据: ${text.slice(0, 200)}`);
    }
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
