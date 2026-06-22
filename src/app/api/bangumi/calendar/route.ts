import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';

export const runtime = 'edge';

export async function GET() {
  try {
    const response = await fetch('https://api.bgm.tv/calendar', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `bgm.tv 返回状态码 ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    const cacheTime = await getCacheTime();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: '获取 Bangumi 日历数据失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
