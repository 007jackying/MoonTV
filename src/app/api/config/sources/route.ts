/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime } from '@/lib/config';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthInfoFromCookie(request);
    const username = auth?.username;
    const sites = await getAvailableApiSites(username);
    const cacheTime = await getCacheTime();
    // 只返回前端需要的公开字段：采集源的 api / detail 地址只在服务端使用，
    // 不下发到浏览器（否则任何登录用户都能在 Network 面板看到全部源地址）。
    const publicSites = sites.map((s) => ({
      key: s.key,
      name: s.name,
      is_adult: s.is_adult,
    }));
    return NextResponse.json(publicSites, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=0`,
      },
    });
  } catch (error) {
    console.error('获取按用户过滤的视频源失败:', error);
    return NextResponse.json(
      { error: '获取视频源失败' },
      { status: 500 }
    );
  }
}