/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'edge';

/**
 * 弹幕 API 代理：/api/danmaku/api/v2/... → <弹幕 API 地址>/api/v2/...
 *
 * 弹幕 API 地址（可能带 token）只保存在服务端，浏览器只请求本站。
 * 只转发 api/v2/ 下的路径，避免被当成任意地址代理。
 */
async function getDanmakuApiBaseUrl(): Promise<string> {
  let baseUrl = '';
  try {
    const config = await getConfig();
    baseUrl = config.SiteConfig.DanmakuApiBaseUrl || '';
  } catch {
    /* 读取配置失败时回落到环境变量 */
  }
  baseUrl =
    baseUrl ||
    process.env.DANMU_API_BASE_URL ||
    process.env.NEXT_PUBLIC_DANMU_API_BASE_URL ||
    '';
  return baseUrl.replace(/\/+$/, '');
}

async function proxy(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const segments = params.path || [];
  const path = segments.map(encodeURIComponent).join('/');
  if (
    !path.startsWith('api/v2/') ||
    segments.some((seg) => seg === '.' || seg === '..' || seg.includes('/'))
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const baseUrl = await getDanmakuApiBaseUrl();
  if (!baseUrl) {
    return NextResponse.json({ error: '未配置弹幕 API' }, { status: 404 });
  }

  // 边缘运行时会把动态段以 path=... 附加到查询串上，转发前去掉
  const search = new URLSearchParams(request.nextUrl.search);
  search.delete('path');
  const query = search.toString();
  const target = `${baseUrl}/${path}${query ? `?${query}` : ''}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  // 浏览器端取消（切换剧集等）时一并取消上游请求
  request.signal?.addEventListener('abort', () => controller.abort());

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: {
        Accept: request.headers.get('accept') || '*/*',
        ...(request.method === 'POST'
          ? {
              'Content-Type':
                request.headers.get('content-type') || 'application/json',
            }
          : {}),
      },
      body: request.method === 'POST' ? await request.text() : undefined,
      signal: controller.signal,
    });

    const headers = new Headers();
    const contentType = upstream.headers.get('content-type');
    if (contentType) headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'no-store');

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    console.error('弹幕 API 代理失败:', (error as Error).message);
    return NextResponse.json({ error: '弹幕 API 请求失败' }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }
}

export { proxy as GET, proxy as POST };
