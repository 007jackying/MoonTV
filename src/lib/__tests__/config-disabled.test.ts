import fs from 'node:fs';
import path from 'node:path';

import type { AdminConfig } from '../admin.types';
import { refineConfig } from '../config';

interface FileApiSite {
  api: string;
  name: string;
  detail?: string;
  is_adult?: boolean;
  disabled?: boolean;
  note?: string;
}

const CONFIG_PATH = path.join(process.cwd(), 'config.json');
const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
const fileConfig = JSON.parse(raw) as {
  api_site: Record<string, FileApiSite>;
};
const entries = Object.entries(fileConfig.api_site);

const adminConfig = (): AdminConfig => ({
  // refineConfig 是从 ConfigFile（config.json 的原始文本）重新解析源信息的，
  // 所以必须带上原文，只给 SourceConfig 不够。
  ConfigFile: raw,
  SiteConfig: {
    SiteName: 'DreamTV',
    Announcement: '',
    SearchDownstreamMaxPage: 1,
    SiteInterfaceCacheTime: 0,
    DoubanProxyType: '',
    DoubanProxy: '',
    DoubanImageProxyType: '',
    DoubanImageProxy: '',
    DisableYellowFilter: false,
  },
  UserConfig: { AllowRegister: false, Users: [], Groups: [] },
  SourceConfig: entries.map(([key, site]) => ({
    key,
    name: site.name,
    api: site.api,
    detail: site.detail,
    is_adult: site.is_adult,
    from: 'config',
    disabled: false,
  })),
  CustomCategories: [],
});

const byKey = (cfg: AdminConfig) =>
  new Map(cfg.SourceConfig.map((s) => [s.key, s]));

const disabledKeys = entries
  .filter(([, site]) => site.disabled === true)
  .map(([key]) => key);

describe('config.json 的 disabled 约定', () => {
  it('config.json 里确实有停用的源（否则本组断言是空转）', () => {
    expect(disabledKeys.length).toBeGreaterThan(0);
  });

  it('每个停用的源都写了 note，说明为什么停用', () => {
    const missing = entries
      .filter(([, site]) => site.disabled === true && !site.note)
      .map(([key]) => key);
    expect(missing).toEqual([]);
  });

  it('没有「只写 note 却没停用」的条目，避免备注与实际状态脱节', () => {
    const stray = entries
      .filter(([, site]) => site.note && site.disabled !== true)
      .map(([key]) => key);
    expect(stray).toEqual([]);
  });

  it('refineConfig 会把 disabled 透传到 SourceConfig', () => {
    const merged = byKey(refineConfig(adminConfig()));

    for (const key of disabledKeys) {
      expect(merged.get(key)?.disabled).toBe(true);
    }

    // 没写 disabled 的源一律保持启用
    for (const [key, site] of entries) {
      if (site.disabled === true) continue;
      expect(merged.get(key)?.disabled).toBe(false);
    }
  });

  it('refineConfig 会新增 config.json 里新增的源，并带上 disabled', () => {
    const cfg = adminConfig();
    // 删掉一个条目，模拟 config.json 新增了源
    const drop = disabledKeys[0];
    cfg.SourceConfig = cfg.SourceConfig.filter((s) => s.key !== drop);

    const merged = byKey(refineConfig(cfg));
    expect(merged.get(drop)?.disabled).toBe(true);
  });

  it('refineConfig 保留 config.json 未声明的存储态 disabled', () => {
    const cfg = adminConfig();
    // 模拟后台管理里手动停用一个 config.json 未声明 disabled 的源
    const target = entries.find(([, site]) => site.disabled !== true);
    if (!target) throw new Error('config.json 里没有启用的源，测试前提不成立');
    const key = target[0];

    cfg.SourceConfig = cfg.SourceConfig.map((s) =>
      s.key === key ? { ...s, disabled: true } : s
    );

    expect(byKey(refineConfig(cfg)).get(key)?.disabled).toBe(true);
  });

  it('config.json 显式写 disabled: false 时，可以覆盖存储里的停用状态', () => {
    const key = disabledKeys[0];
    const cfg = adminConfig();
    cfg.SourceConfig = cfg.SourceConfig.map((s) =>
      s.key === key ? { ...s, disabled: false } : s
    );

    const patched = JSON.parse(raw) as {
      api_site: Record<string, FileApiSite>;
    };
    patched.api_site[key] = { ...patched.api_site[key], disabled: false };
    const cfg2 = { ...cfg, ConfigFile: JSON.stringify(patched) };

    expect(byKey(refineConfig(cfg2)).get(key)?.disabled).toBe(false);
  });
});
