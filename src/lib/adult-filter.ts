/**
 * AV（成人）采集源过滤。
 *
 * 纯函数模块，客户端与服务端共用：
 * - 服务端：`filterAdult` 查询参数决定本次请求是否过滤。缺省**不过滤**，因此
 *   TVBox、OrionTV、定时刷新等不带该参数的外部调用方行为不变。所有搜索/加载
 *   路由统一走 `getAvailableApiSitesForRequest()`（见 lib/config.ts）。
 * - 客户端：偏好存在 localStorage（每个浏览器独立），由
 *   `adult-filter.client.ts` 在每次搜索/加载请求上追加 `filterAdult` 参数。
 *
 * 判定依据二选一，命中任一即视为 AV 源：
 * 1. config.json 中 `api_site.<key>.is_adult === true`
 * 2. 源的展示名带 `AV-` / `AV ` / `av_` 前缀（自建源没有 is_adult 时的回退）
 */

/** 请求参数名：1/true 开启过滤，0/false/off 关闭过滤，缺省表示不过滤 */
export const ADULT_FILTER_PARAM = 'filterAdult';

/** localStorage 键名（用户偏好，存在浏览器本地） */
export const ADULT_FILTER_STORAGE_KEY = 'filterAdultSources';

/** 过滤开关的默认值：默认开启 */
export const DEFAULT_FILTER_ADULT_SOURCES = true;

/** 设置变更事件名，与 SourceSelector 派发的 searchSettingsChanged 是同一个事件 */
export const ADULT_FILTER_CHANGED_EVENT = 'searchSettingsChanged';

export interface AdultSourceLike {
  name?: string;
  is_adult?: boolean;
}

/**
 * 名称前缀判定：兼容 `AV-xxx` / `AV xxx` / `av_xxx` 等写法。
 * 用「前缀 + 分隔符」而不是单纯 `startsWith('AV')`，避免误伤 `AVPlayer`
 * 这类名字里恰好以 AV 开头的普通源。
 */
const ADULT_NAME_PATTERN = /^AV[\s\-_·:：]/i;

/** 判断单个源是否为 AV 源：优先 is_adult 标记，其次回退到名称前缀 */
export function isAdultSource(
  site: AdultSourceLike | null | undefined
): boolean {
  if (!site) return false;
  if (site.is_adult === true) return true;
  return ADULT_NAME_PATTERN.test(site.name ?? '');
}

/** 过滤掉列表中的 AV 源，保留其余元素的顺序 */
export function filterAdultSources<T extends AdultSourceLike>(sites: T[]): T[] {
  return sites.filter((site) => !isAdultSource(site));
}

/** 解析请求参数，判断本次请求是否需要过滤 AV 源；参数缺省时不过滤 */
export function parseAdultFilterParam(
  searchParams: Pick<URLSearchParams, 'get'>
): boolean {
  const raw = searchParams.get(ADULT_FILTER_PARAM);
  if (raw === null || raw === '') return false;
  const normalized = raw.trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false' && normalized !== 'off';
}
