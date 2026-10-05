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
 * 当前用户可选的采集源。
 *
 * 服务端已按用户分组与 disabled 标记过滤；这里再按本地偏好裁掉 AV 源。注意是在
 * **客户端**裁剪：`/api/config/sources` 的响应带 CDN 缓存，且与用户偏好无关，
 * 在客户端裁剪可以让开着/关着过滤的两种用户共用同一份缓存响应。
 */
export async function getAvailableApiSitesClient(): Promise<ApiSite[]> {
  try {
    const res = await fetch('/api/config/sources');
    if (!res.ok) {
      throw new Error('Failed to fetch sources');
    }
    const data = await res.json();
    const sites = data.map((site: any) => ({
      key: site.key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      is_adult: site.is_adult,
    })) as ApiSite[];
    return getFilterAdultSources() ? filterAdultSources(sites) : sites;
  } catch (error) {
    console.error('Failed to fetch available API sites:', error);
    return [];
  }
}