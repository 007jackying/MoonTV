/* eslint-disable @typescript-eslint/no-explicit-any */

/** 一条弹幕。mode: 0 滚动，1 顶部，2 底部 */
export interface DanmakuItem {
  time: number;
  text: string;
  color: string;
  mode: 0 | 1 | 2;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// B 站模式：1-3 滚动，4 底部，5 顶部
function toMode(raw: number): 0 | 1 | 2 {
  if (raw === 4) return 2;
  if (raw === 5) return 1;
  return 0;
}

function toColor(raw: number): string {
  if (!Number.isFinite(raw)) return '#FFFFFF';
  return `#${(raw & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** 解析 B 站格式 XML：<d p="时间,模式,字号,颜色,...">文本</d> */
export function parseDanmakuXml(xml: string): DanmakuItem[] {
  const items: DanmakuItem[] = [];
  const re = /<d[^>]*?p="([^"]+)"[^>]*>([\s\S]*?)<\/d>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const p = m[1].split(',');
    const text = decodeEntities(m[2].trim());
    if (!text || text.length > 100) continue;
    items.push({
      time: Number(p[0]) || 0,
      mode: toMode(Number(p[1])),
      color: toColor(Number(p[3])),
      text,
    });
  }
  return items.sort((a, b) => a.time - b.time);
}

/** 解析 JSON 格式（弹弹play: { comments: [{ p: "时间,模式,颜色,用户", m: "文本" }] }） */
export function parseDanmakuJson(data: any): DanmakuItem[] {
  const list: any[] = Array.isArray(data)
    ? data
    : data?.comments || data?.danmuku || [];
  const items: DanmakuItem[] = [];
  for (const c of list) {
    if (Array.isArray(c)) {
      // [time, mode, color, author, text]
      items.push({
        time: Number(c[0]) || 0,
        mode: toMode(Number(c[1])),
        color: toColor(Number(c[2])),
        text: String(c[4] ?? ''),
      });
    } else if (c && typeof c.p === 'string') {
      const p = c.p.split(',');
      items.push({
        time: Number(p[0]) || 0,
        mode: toMode(Number(p[1])),
        color: toColor(Number(p[2])),
        text: String(c.m ?? ''),
      });
    }
  }
  return items
    .filter((d) => d.text && d.text.length <= 100)
    .sort((a, b) => a.time - b.time);
}

export async function fetchDanmaku(
  url: string,
  signal?: AbortSignal
): Promise<DanmakuItem[]> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`弹幕请求失败: ${res.status}`);
  const text = await res.text();
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseDanmakuJson(JSON.parse(trimmed));
  }
  return parseDanmakuXml(trimmed);
}

/** 二分查找第一条 time >= t 的弹幕下标 */
export function lowerBound(items: DanmakuItem[], t: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
