/**
 * AV 源过滤的客户端一侧：读写本地偏好，并把它翻译成请求参数。
 *
 * 偏好只存在浏览器本地（每个用户独立），因此服务端必须靠请求参数才知道要不要
 * 过滤 —— 这也是为什么所有搜索/加载请求都要经过 withAdultFilterParam()。
 */

'use client';

import {
  ADULT_FILTER_CHANGED_EVENT,
  ADULT_FILTER_PARAM,
  ADULT_FILTER_STORAGE_KEY,
  DEFAULT_FILTER_ADULT_SOURCES,
} from './adult-filter';

/**
 * 读取本地的 AV 源过滤开关，未设置时返回默认值（默认开启）。
 * 同时兼容 `'true'` 裸字符串与 `JSON.stringify(bool)` 两种写法，与仓库里其它
 * localStorage 开关的编码方式保持一致。
 */
export function getFilterAdultSources(): boolean {
  if (typeof window === 'undefined') return DEFAULT_FILTER_ADULT_SOURCES;
  const saved = window.localStorage.getItem(ADULT_FILTER_STORAGE_KEY);
  if (saved === null) return DEFAULT_FILTER_ADULT_SOURCES;
  if (saved === 'true' || saved === 'false') return saved === 'true';
  try {
    const parsed = JSON.parse(saved);
    return typeof parsed === 'boolean' ? parsed : DEFAULT_FILTER_ADULT_SOURCES;
  } catch {
    return DEFAULT_FILTER_ADULT_SOURCES;
  }
}

/**
 * 写入本地的 AV 源过滤开关，并广播设置变更。
 *
 * 广播走 SourceSelector 已经在用的 searchSettingsChanged 事件：切换开关后
 * 已经挂载的组件（例如搜索页的源选择器）会立刻重新裁剪可选源，而不必刷新页面。
 */
export function setFilterAdultSources(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    ADULT_FILTER_STORAGE_KEY,
    JSON.stringify(enabled)
  );
  window.dispatchEvent(
    new CustomEvent(ADULT_FILTER_CHANGED_EVENT, {
      detail: { filterAdultSources: enabled },
    })
  );
}

/**
 * 给搜索/加载类请求追加 `filterAdult` 参数，使后端在本次请求中跳过 AV 源。
 *
 * 仅在开启过滤时追加：关闭时保持 URL 原样，不无谓地打散 CDN / 浏览器缓存。
 */
export function withAdultFilterParam(url: string): string {
  if (!getFilterAdultSources()) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${ADULT_FILTER_PARAM}=1`;
}
