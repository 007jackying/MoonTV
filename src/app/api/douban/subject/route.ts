import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { fetchDoubanData, resolveDoubanProxy } from '@/lib/douban';
import {
  doubanAbstractUrl,
  doubanRexxarUrl,
  parseDoubanRate,
} from '@/lib/douban-rating';

export const runtime = 'edge';

/**
 * 豆瓣条目评分：GET /api/douban/subject?id=<豆瓣ID> → { rate: '7.5' | null }
 *
 * 先查 subject_abstract，失败或无评分时再查移动端 rexxar 接口。
 * 「暂无评分」返回 { rate: null }（可缓存）；两个上游都请求失败时也返回
 * { rate: null }（200，附 error，no-store）。id 非法返回 400。
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'id 参数无效' }, { status: 400 });
  }

  const proxy = await resolveDoubanProxy(searchParams);
  let rate: string | null = null;
  let reached = false;
  const errors: string[] = [];

  try {
    rate = parseDoubanRate(
      await fetchDoubanData(doubanAbstractUrl(id), undefined, proxy)
    );
    reached = true;
  } catch (e) {
    errors.push((e as Error).message);
  }

  if (!rate) {
    try {
      rate = parseDoubanRate(
        await fetchDoubanData(
          doubanRexxarUrl(id),
          'https://m.douban.com/',
          proxy
        )
      );
      reached = true;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  // 豆瓣不可达时与「暂无评分」同样返回 200，按钮只显示「豆瓣」；不缓存，下次可重试。
  // 不用 5xx：服务器访问不了豆瓣的部署里，每次打开播放页都会在控制台报错。
  if (!reached) {
    return NextResponse.json(
      { rate: null, error: '获取豆瓣评分失败', details: errors.join('; ') },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const cacheTime = await getCacheTime();
  return NextResponse.json(
    { rate },
    {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    }
  );
}
