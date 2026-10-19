/* eslint-disable no-console */

import { getConfig } from './config';
import { IMAGE_PROXY_PATH, openImageToken } from './image-seal';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

/** 豆瓣图片按站点配置的图片代理方式改写（原来由浏览器端 processImageUrl 处理） */
async function applyDoubanImageProxy(url: string): Promise<string> {
  if (!/img\d+\.doubanio\.com/.test(url)) return url;
  let type = 'direct';
  let proxyUrl = '';
  try {
    const { SiteConfig } = await getConfig();
    type = SiteConfig.DoubanImageProxyType || 'direct';
    proxyUrl = SiteConfig.DoubanImageProxy || '';
  } catch {
    /* 读取配置失败时直连 */
  }
  switch (type) {
    case 'img3':
      return url.replace(/img\d+\.doubanio\.com/g, 'img3.doubanio.com');
    case 'cmliussss-cdn-tencent':
      return url.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.net'
      );
    case 'cmliussss-cdn-ali':
      return url.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.com'
      );
    case 'custom':
      return proxyUrl ? `${proxyUrl}${encodeURIComponent(url)}` : url;
    default:
      return url;
  }
}

function refererFor(url: string): string | undefined {
  if (/doubanio\.com/.test(url)) return 'https://movie.douban.com/';
  return undefined;
}

/**
 * 代为请求上游图片并原样流式返回。
 * 只放行图片（或 octet-stream），避免被用来转发其它类型的内容。
 */
export async function proxyUpstreamImage(url: string): Promise<Response> {
  const target = await applyDoubanImageProxy(url);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const referer = refererFor(url);
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        ...(referer ? { Referer: referer } : {}),
      },
      signal: controller.signal,
      // 不进 Next 的 Data Cache：海报数量无上限，缓存交给浏览器 / CDN（见下方 Cache-Control）
      cache: 'no-store',
    });
    if (!upstream.ok || !upstream.body) {
      return new Response(null, {
        status: upstream.ok ? 502 : upstream.status,
      });
    }
    const contentType = upstream.headers.get('content-type') || '';
    if (
      contentType &&
      !/^image\//i.test(contentType) &&
      !/^application\/octet-stream/i.test(contentType)
    ) {
      return new Response(null, { status: 415 });
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType || 'application/octet-stream');
    const length = upstream.headers.get('content-length');
    if (length) headers.set('Content-Length', length);
    headers.set('X-Content-Type-Options', 'nosniff');
    // 令牌与图片地址一一对应，内容不会变：长期缓存，CDN 命中后不再消耗源站流量
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('CDN-Cache-Control', 'public, s-maxage=31536000');
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=31536000');
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    console.error('图片代理失败:', (error as Error).message);
    return new Response(null, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }
}

/** /api/img/<令牌>；令牌无效返回 404 */
export async function proxySealedImage(token: string): Promise<Response> {
  const url = await openImageToken(token);
  if (!url) return new Response(null, { status: 404 });
  return proxyUpstreamImage(url);
}

/** 从 /api/img/<令牌> 形式的地址里取出令牌 */
export function tokenFromProxiedUrl(url: string): string | null {
  return url.startsWith(IMAGE_PROXY_PATH)
    ? url.slice(IMAGE_PROXY_PATH.length) || null
    : null;
}
