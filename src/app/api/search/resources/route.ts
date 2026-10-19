import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  getAvailableApiSites,
  getCacheTime,
  toPublicApiSites,
} from '@/lib/config';

export const runtime = 'edge';

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthInfoFromCookie(request);
    const username = auth?.username;
    const apiSites = await getAvailableApiSites(username);
    const cacheTime = await getCacheTime();

    // 采集站地址只在服务端使用，客户端用 key 调 /api/search/one 等接口
    return NextResponse.json(toPublicApiSites(apiSites), {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: '获取资源失败' }, { status: 500 });
  }
}
