import { NextRequest } from 'next/server';

import { proxySealedImage } from '@/lib/image-fetch';

export const runtime = 'edge';

/**
 * 海报图片代理：GET /api/img/<令牌>
 *
 * 令牌由服务端加密生成（见 lib/image-seal.ts），浏览器看不到真实图片地址。
 * 不需要登录（middleware 已放行）：令牌只能由服务端签发，不能拿来代理任意地址，
 * 放行后 CDN 也能缓存，OrionTV 等客户端加载图片时不必带 Cookie。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string } }
) {
  return proxySealedImage(params.token);
}
