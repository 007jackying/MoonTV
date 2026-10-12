/**
 * 豆瓣评分：服务端路由（/api/douban/subject）与浏览器端代理请求共用的解析逻辑。
 *
 * 支持两种上游返回：
 *   - movie.douban.com/j/subject_abstract?subject_id=ID → { subject: { rate: '7.5' } }
 *   - m.douban.com/rexxar/api/v2/subject/ID             → { rating: { value: 7.5 } }
 */

export function doubanAbstractUrl(id: number, host = 'movie.douban.com') {
  return `https://${host}/j/subject_abstract?subject_id=${id}`;
}

export function doubanRexxarUrl(id: number) {
  return `https://m.douban.com/rexxar/api/v2/subject/${id}`;
}

/** 归一化为一位小数的字符串；无评分 / 暂无评分 / 非法值返回 null */
export function normalizeDoubanRate(value: unknown): string | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
      ? parseFloat(value)
      : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 10) return null;
  return n.toFixed(1);
}

export function parseDoubanRate(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as {
    subject?: { rate?: unknown };
    rating?: { value?: unknown } | null;
  };
  return (
    normalizeDoubanRate(d.subject?.rate) ?? normalizeDoubanRate(d.rating?.value)
  );
}
