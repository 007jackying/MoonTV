/**
 * 从豆瓣的 episodes_info 字段中解析集数
 * 例如 "更新至12集"、"全24集"、"12集全"、"共8集"；电影或无信息时为空
 */
export function parseDoubanEpisodes(info?: string | null): number | undefined {
  const n = Number(info?.match(/(\d+)\s*集/)?.[1]);
  return n > 0 ? n : undefined;
}
