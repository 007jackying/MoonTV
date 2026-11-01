/** 下载文件名：去掉各系统不允许的字符和已有的视频扩展名，再加上正确的扩展名 */

export function sanitizeFilename(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/\.(mp4|ts|m3u8)$/i, '')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 150)
    .trim();
  return cleaned || 'video';
}

export function buildFilename(title: string, type: 'TS' | 'MP4'): string {
  return `${sanitizeFilename(title)}.${type.toLowerCase()}`;
}

/** 从源站的集标题里取集数（第3集 / 第03话 / EP03 / 03），取不到时用位置 */
export function episodeNumber(
  title: string | undefined,
  index: number
): number {
  const m =
    title?.match(/第\s*0*(\d+)\s*[集话話期]/) ||
    title?.match(/\bE(?:P)?\s*0*(\d+)\b/i) ||
    title?.trim().match(/^0*(\d+)$/);
  return m ? Number(m[1]) : index + 1;
}

/**
 * 剧集的下载文件名（不含扩展名）：`片名 第03集` / `片名 E03`。
 * 集数补零到至少两位（按总集数决定位数），文件夹里能按集数顺序排列；
 * 源站的集标题不是集数（如「特别篇」）时附在后面。只有一集（电影）时就是片名。
 */
export function episodeFileTitle(
  seriesTitle: string,
  episodeTitle: string | undefined,
  index: number,
  total: number,
  lang: 'zh' | 'en'
): string {
  const series = seriesTitle.trim();
  if (total <= 1) return series;
  const n = episodeNumber(episodeTitle, index);
  const width = Math.max(2, String(Math.max(total, n)).length);
  const padded = String(n).padStart(width, '0');
  const label = lang === 'en' ? `E${padded}` : `第${padded}集`;
  const raw = episodeTitle?.trim() ?? '';
  const isNumberOnly =
    !raw ||
    /^第?\s*0*\d+\s*[集话話期]?$/.test(raw) ||
    /^E(?:P)?\s*0*\d+$/i.test(raw);
  return `${series} ${label}${isNumberOnly ? '' : ` ${raw}`}`;
}
