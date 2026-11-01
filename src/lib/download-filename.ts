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
