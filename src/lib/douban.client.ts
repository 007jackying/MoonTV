/**
 * 浏览器端豆瓣数据入口。
 *
 * 所有请求都只发往本站 /api/douban/*，由服务端按站点配置（或用户选择的预设数据源）
 * 访问豆瓣 / 镜像 / 代理，浏览器的网络请求里看不到真实上游地址。
 */

import { normalizeDoubanRate } from './douban-rating';
import { DoubanResult } from './types';

interface DoubanCategoriesParams {
  kind: 'tv' | 'movie';
  category: string;
  type: string;
  pageLimit?: number;
  pageStart?: number;
}

/** 与服务端 DOUBAN_PROXY_PRESETS 保持一致 */
const DOUBAN_PROXY_PRESETS = [
  'direct',
  'cors-proxy-zwei',
  'cmliussss-cdn-tencent',
  'cmliussss-cdn-ali',
];

/** 用户在设置里选了预设数据源时追加 proxy 参数；否则由服务端用站点配置 */
function withDoubanProxyParam(url: string): string {
  let proxyType: string | null = null;
  try {
    proxyType = localStorage.getItem('doubanDataSource');
  } catch {
    /* localStorage 不可用时用站点配置 */
  }
  if (!proxyType || !DOUBAN_PROXY_PRESETS.includes(proxyType)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}proxy=${encodeURIComponent(
    proxyType
  )}`;
}

async function fetchDoubanResult(url: string): Promise<DoubanResult> {
  const response = await fetch(withDoubanProxyParam(url));
  return response.json();
}

/**
 * 豆瓣分类数据
 */
export async function getDoubanCategories(
  params: DoubanCategoriesParams
): Promise<DoubanResult> {
  const { kind, category, type, pageLimit = 20, pageStart = 0 } = params;
  return fetchDoubanResult(
    `/api/douban/categories?kind=${kind}&category=${category}&type=${type}&limit=${pageLimit}&start=${pageStart}`
  );
}

interface DoubanListParams {
  tag: string;
  type: string;
  pageLimit?: number;
  pageStart?: number;
}

export async function getDoubanList(
  params: DoubanListParams
): Promise<DoubanResult> {
  const { tag, type, pageLimit = 20, pageStart = 0 } = params;
  return fetchDoubanResult(
    `/api/douban?tag=${tag}&type=${type}&pageSize=${pageLimit}&pageStart=${pageStart}`
  );
}

interface DoubanRecommendsParams {
  kind: 'tv' | 'movie';
  pageLimit?: number;
  pageStart?: number;
  category?: string;
  format?: string;
  label?: string;
  region?: string;
  year?: string;
  platform?: string;
  sort?: string;
}

export async function getDoubanRecommends(
  params: DoubanRecommendsParams
): Promise<DoubanResult> {
  const {
    kind,
    pageLimit = 20,
    pageStart = 0,
    category,
    format,
    label,
    region,
    year,
    platform,
    sort,
  } = params;
  return fetchDoubanResult(
    `/api/douban/recommends?kind=${kind}&limit=${pageLimit}&start=${pageStart}&category=${category}&format=${format}&region=${region}&year=${year}&platform=${platform}&sort=${sort}&label=${label}`
  );
}

// 同一豆瓣 ID 在本次会话内只请求一次（切换集数 / 桌面与移动端布局共用）
const doubanRatingCache = new Map<number, Promise<string | null>>();

/**
 * 获取豆瓣评分（一位小数字符串，如 '7.5'）；暂无评分或请求失败返回 null。
 */
export function getDoubanRating(doubanId: number): Promise<string | null> {
  if (!doubanId) return Promise.resolve(null);
  const cached = doubanRatingCache.get(doubanId);
  if (cached) return cached;

  const request = fetchDoubanRating(doubanId).catch(() => null);
  doubanRatingCache.set(doubanId, request);
  // 拿不到评分（请求失败或暂无评分）不缓存，下次进入播放页重试
  request.then((rate) => {
    if (rate === null) doubanRatingCache.delete(doubanId);
  });
  return request;
}

async function fetchDoubanRating(doubanId: number): Promise<string | null> {
  const response = await fetch(
    withDoubanProxyParam(`/api/douban/subject?id=${doubanId}`)
  );
  if (!response.ok) return null;
  return normalizeDoubanRate((await response.json())?.rate);
}
