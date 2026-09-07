import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

/**
 * HLS 播放代理。
 *
 * 大部分上游 CDN 的 m3u8 不带 Access-Control-Allow-Origin，而 hls.js 是用 XHR 取
 * 播放列表和每一个 .ts 分片的，两者都受 CORS 限制 —— 于是浏览器直接拦掉，播放器
 * 永远停在「视频加载中」。服务端取流不受 CORS 限制，所以这里代理一层。
 *
 * 关键点：**只代理播放列表是不够的**。列表里的分片地址仍然指向上游，hls.js 取分片
 * 时照样被拦。所以要把列表里所有的地址（子列表 / 分片 / #EXT-X-KEY 的 URI /
 * #EXT-X-MAP 的 URI）统统改写成指回本接口。
 */

const UPSTREAM_HEADERS = {
  // 有些站点会按 UA 拒绝，给一个正常浏览器的标识
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

/**
 * 挡掉指向内网/回环的目标。
 * 只看字面量地址，挡不住 DNS 重绑定 —— 但对"登录用户拿它扫内网"这种最直接的
 * 用法已经足够，而且 edge runtime 里也做不了 DNS 解析。
 */
function isPrivateHost(hostname: string) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd')) return true; // IPv6 回环 / ULA
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // 云环境的元数据地址
  return false;
}

function selfUrl(request: NextRequest, target: string) {
  return `${new URL(request.url).origin}/api/hls?url=${encodeURIComponent(target)}`;
}

/** 把一行里的相对地址解析成绝对地址，再改写成走本代理 */
function rewriteUri(uri: string, base: string, request: NextRequest) {
  const absolute = new URL(uri, base).toString();
  return selfUrl(request, absolute);
}

/** 改写 #EXT-X-KEY / #EXT-X-MAP 这类 URI="..." 属性 */
function rewriteAttrUri(line: string, base: string, request: NextRequest) {
  return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
    return `URI="${rewriteUri(uri, base, request)}"`;
  });
}

function rewritePlaylist(text: string, base: string, request: NextRequest) {
  return text
    .split('\n')
    .map((rawLine) => {
      const line = rawLine.trim();
      if (!line) return rawLine;

      if (line.startsWith('#')) {
        // 带 URI="..." 的标签（加密密钥、初始化分片）也要改写
        return line.includes('URI="')
          ? rewriteAttrUri(rawLine, base, request)
          : rawLine;
      }

      // 非 # 开头的行就是子列表或分片地址
      return rewriteUri(line, base, request);
    })
    .join('\n');
}

export async function GET(request: NextRequest) {
  const target = new URL(request.url).searchParams.get('url');
  if (!target) {
    return NextResponse.json({ error: '缺少 url 参数' }, { status: 400 });
  }

  let upstream: URL;
  try {
    upstream = new URL(target);
  } catch {
    return NextResponse.json({ error: 'url 不合法' }, { status: 400 });
  }
  if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') {
    return NextResponse.json({ error: '只支持 http/https' }, { status: 400 });
  }
  if (isPrivateHost(upstream.hostname)) {
    // 这个接口会用服务端的身份去取任意 URL。中间件已经要求登录，但仍然要挡住
    // 指向内网/回环的地址，否则等于把内网探测能力开放给了登录用户（SSRF）。
    return NextResponse.json({ error: '不允许访问内网地址' }, { status: 400 });
  }

  // 分片请求要把 Range 透传过去，否则拖动进度条会失效
  const range = request.headers.get('range');
  const headers: Record<string, string> = { ...UPSTREAM_HEADERS };
  if (range) headers['Range'] = range;

  let res: Response;
  try {
    res = await fetch(upstream.toString(), { headers, redirect: 'follow' });
  } catch (e) {
    return NextResponse.json(
      { error: '上游拉取失败', message: (e as Error).message },
      { status: 502 }
    );
  }

  if (!res.ok && res.status !== 206) {
    return NextResponse.json(
      { error: `上游返回 ${res.status}` },
      { status: res.status }
    );
  }

  const contentType = res.headers.get('content-type') || '';
  const looksLikePlaylist =
    /mpegurl/i.test(contentType) || /\.m3u8($|\?)/i.test(upstream.pathname);

  if (looksLikePlaylist) {
    const text = await res.text();
    // 有些站点 content-type 不对，用内容再确认一次
    if (text.trimStart().startsWith('#EXTM3U')) {
      // redirect 之后的最终地址才是解析相对路径的基准
      const base = res.url || upstream.toString();
      return new NextResponse(rewritePlaylist(text, base, request), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    // 不是播放列表就按普通内容返回
    return new NextResponse(text, {
      status: res.status,
      headers: {
        'Content-Type': contentType || 'text/plain',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // 分片 / 密钥：原样流式转发
  const passthrough: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
  };
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = res.headers.get(h);
    if (v) passthrough[h] = v;
  }

  return new NextResponse(res.body, { status: res.status, headers: passthrough });
}
