import fs from 'node:fs';
import path from 'node:path';

// 搜索页「按来源筛选」按 source_name 过滤，同名的源在筛选里分不开；
// 后台与播放页的源列表也只显示名称。重名时在末尾加序号：`名称-1`、`名称-2`。
const sites = (
  JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf-8'),
  ) as { api_site: Record<string, { name: string }> }
).api_site;

describe('config.json 源名称', () => {
  it('每个源的 name 都不重复（含已停用的源）', () => {
    const byName = new Map<string, string[]>();
    for (const [key, site] of Object.entries(sites)) {
      byName.set(site.name, [...(byName.get(site.name) || []), key]);
    }
    const dups = Array.from(byName.entries()).filter(
      ([, keys]) => keys.length > 1,
    );
    expect(dups).toEqual([]);
  });
});
