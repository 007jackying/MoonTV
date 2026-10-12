/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  zwsp: '\u200b',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  middot: '·',
  bull: '•',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  times: '×',
  deg: '°',
  copy: '©',
  reg: '®',
  trade: '™',
};

function decodeCodePoint(raw: string, cp: number): string {
  return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff
    ? String.fromCodePoint(cp)
    : raw;
}

function decodeEntitiesOnce(text: string): string {
  return (
    text
      .replace(
        /&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]*));/gi,
        (raw, dec, hex, name) => {
          if (dec) return decodeCodePoint(raw, Number(dec));
          if (hex) return decodeCodePoint(raw, parseInt(hex, 16));
          return NAMED_ENTITIES[name.toLowerCase()] ?? raw;
        }
      )
      // 部分源会漏掉分号，如 "&nbsp&nbsp"
      .replace(/&nbsp(?![a-z0-9;])/gi, '\u00a0')
  );
}

function decodeHtmlEntities(text: string): string {
  // 采集站常见二次转义（&amp;nbsp;），最多解码三轮直到稳定
  let out = text;
  for (let i = 0; i < 3 && out.includes('&'); i++) {
    const next = decodeEntitiesOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

function getDoubanImageProxyConfig(): {
  proxyType:
    | 'direct'
    | 'server'
    | 'img3'
    | 'cmliussss-cdn-tencent'
    | 'cmliussss-cdn-ali'
    | 'custom';
  proxyUrl: string;
} {
  const doubanImageProxyType =
    localStorage.getItem('doubanImageProxyType') ||
    (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE ||
    'direct';
  const doubanImageProxy =
    localStorage.getItem('doubanImageProxyUrl') ||
    (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY ||
    '';
  return {
    proxyType: doubanImageProxyType,
    proxyUrl: doubanImageProxy,
  };
}

/**
 * 处理图片 URL，如果设置了图片代理则使用代理
 */
export function processImageUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  // 仅处理豆瓣图片代理
  if (!originalUrl.includes('doubanio.com')) {
    return originalUrl;
  }

  const { proxyType, proxyUrl } = getDoubanImageProxyConfig();
  switch (proxyType) {
    case 'server':
      return `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
    case 'img3':
      return originalUrl.replace(/img\d+\.doubanio\.com/g, 'img3.doubanio.com');
    case 'cmliussss-cdn-tencent':
      return originalUrl.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.net'
      );
    case 'cmliussss-cdn-ali':
      return originalUrl.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.com'
      );
    case 'custom':
      return `${proxyUrl}${encodeURIComponent(originalUrl)}`;
    case 'direct':
    default:
      return originalUrl;
  }
}

export function cleanHtmlTags(text: string): string {
  if (!text) return '';

  // 先解码实体：转义过的标签（&lt;p&gt;）也能在下一步被剥掉
  return (
    decodeHtmlEntities(text)
      .replace(/<!--[\s\S]*?-->/g, '')
      // 块级标签 / <br> 换行，其余行内标签直接去掉，避免句子被拆断
      .replace(
        /<\/?(?:br|p|div|li|ul|ol|h[1-6]|tr|table|section|article|blockquote)\b[^>]*>/gi,
        '\n'
      )
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u200b|\u200c|\u200d|\ufeff/g, '') // 零宽字符
      .replace(/[^\S\n]+/g, ' ') // 空格 / 制表符 / &nbsp; / 全角空格等合并为一个空格
      .replace(/ *\n */g, '\n') // 去掉行首尾空格
      .replace(/\n+/g, '\n') // 将多个连续换行合并为一个
      .trim()
  );
}

/**
 * 获取配置的超时时间（秒）
 * 从 localStorage 读取，如果不存在或无效则返回默认值3秒
 */
export function getRequestTimeout(): number {
  if (typeof window === 'undefined') {
    return 30; // 服务器端返回默认值
  }

  try {
    const savedTimeout = localStorage.getItem('requestTimeout');
    if (savedTimeout) {
      const timeoutSeconds = parseInt(savedTimeout, 10);
      if (
        !isNaN(timeoutSeconds) &&
        timeoutSeconds >= 1 &&
        timeoutSeconds <= 60
      ) {
        return timeoutSeconds;
      }
    }
  } catch (error) {
    console.warn('Failed to read timeout from localStorage:', error);
  }

  return 30; // 默认30秒
}
