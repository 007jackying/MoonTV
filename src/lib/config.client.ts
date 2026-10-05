/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { filterAdultSources } from './adult-filter';
import { getFilterAdultSources } from './adult-filter.client';

export async function getCustomCategories(): Promise<{
  name: string;
  type: 'movie' | 'tv';
  query: string;
}[]> {
  const res = await fetch('/api/config/custom_category');
  const data = await res.json();
  return data.filter((item: any) => !item.disabled).map((category: any) => ({
    name: category.name || '',
    type: category.type,
    query: category.query,
  }));
}

export interface ApiSite {
  key: string;
  name: string;
  api: string;
  detail?: string;
  is_adult?: boolean;
}

/**
 * `/api/config/sources` 的原始返回，**不做**本地偏好裁剪。
 *
 * 服务端已按用户分组与 disabled 标记过滤，但这一份响应是带缓存的、且与用户偏好无关，
 * 所以 AV 源的裁剪放在客户端做（见 trimForLocalPreference），开着/关着过滤的两种用户
 * 才能共用同一份缓存响应。
 *
 * 需要区分"源不存在了"和"源只是被偏好藏起来了"的调用方（例如 SourceSelector 判断
 * 能不能从 savedSources 里删掉某个 key）请用这个，而不是 getAvailableApiSitesClient。
 */
export async function fetchApiSites(): Promise<ApiSite[]> {
  try {
    const res = await fetch('/api/config/sources');
    if (!res.ok) {
      throw new Error('Failed to fetch sources');
    }
    const data = await res.json();
    return data.map((site: any) => ({
      key: site.key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      is_adult: site.is_adult,
    })) as ApiSite[];
  } catch (error) {
    console.error('Failed to fetch available API sites:', error);
    return [];
  }
}

/** 按本地偏好（当前是"过滤 AV 资源"开关）裁掉 AV 源 */
export function trimForLocalPreference(sites: ApiSite[]): ApiSite[] {
  return getFilterAdultSources() ? filterAdultSources(sites) : sites;
}

/** 当前用户可选的采集源 = 服务端按用户/disabled 过滤 + 本地偏好裁剪 */
export async function getAvailableApiSitesClient(): Promise<ApiSite[]> {
  return trimForLocalPreference(await fetchApiSites());
}
