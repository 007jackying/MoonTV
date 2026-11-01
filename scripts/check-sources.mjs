#!/usr/bin/env node
/**
 * 实测 config.json 里的采集源是否可用。
 *
 * 每个源只发一次请求，与站内搜索完全相同：`<api>?ac=videolist&wd=<关键词>`，
 * UA / Accept 与 src/lib/config.ts 的 API_CONFIG.search.headers 一致。
 * 结果按 config.json 里 `note` 的写法归类（HTTP 403、返回 HTML、缺少 list、
 * "暂不支持搜索"、DNS/连接失败……），方便直接抄进 note。
 *
 * 用法：
 *   node scripts/check-sources.mjs                      # 全部源
 *   node scripts/check-sources.mjs kuaikan yhdm dm84    # 只测指定 key
 *   node scripts/check-sources.mjs --enabled            # 跳过已 disabled 的源
 *   node scripts/check-sources.mjs --disabled           # 只测已 disabled 的源（看能否恢复）
 *   node scripts/check-sources.mjs --wd=斗罗大陆 --timeout=15000 --json
 *
 * 测试候选源（不改 config.json）：
 *   node scripts/check-sources.mjs --config=scripts/source-candidates.json
 *   node scripts/check-sources.mjs --config=scripts/source-candidates.json --ok-json > ok.json
 *   --ok-json 只输出可用源的 {"key": {...}} 片段，可直接粘进 config.json 的 api_site
 *
 * 只要有源不可用，退出码为 1。
 * 注意：要在能访问这些站点的网络里运行（本机或服务器）；
 * 部分源有地域封锁，结果因出口 IP 而异。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const keys = args.filter((a) => !a.startsWith('--'));

const WD = opt('wd', '斗罗大陆');
const TIMEOUT = Number(opt('timeout', 10000));
const CONCURRENCY = Number(opt('concurrency', 8));
const CONFIG = path.resolve(opt('config', 'config.json'));

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

const sites = JSON.parse(fs.readFileSync(CONFIG, 'utf-8')).api_site || {};
let entries = Object.entries(sites);
if (keys.length) {
  const unknown = keys.filter((k) => !sites[k]);
  if (unknown.length) {
    console.error(`config.json 里没有这些 key：${unknown.join(', ')}`);
    process.exit(2);
  }
  entries = entries.filter(([k]) => keys.includes(k));
}
if (flag('enabled')) entries = entries.filter(([, s]) => s.disabled !== true);
if (flag('disabled')) entries = entries.filter(([, s]) => s.disabled === true);

async function probe([key, site]) {
  const url = site.api + '?ac=videolist&wd=' + encodeURIComponent(WD);
  const started = Date.now();
  const base = { key, name: site.name, disabled: site.disabled === true, url };
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: 'follow',
    });
    const ms = Date.now() - started;
    const text = await res.text();
    const type = res.headers.get('content-type') || '';
    const fail = (reason) => ({
      ...base,
      ok: false,
      ms,
      status: res.status,
      reason,
    });

    if (!res.ok) return fail(`源站返回 HTTP ${res.status}`);
    if (!text.trim()) return fail('源站返回空响应体');
    if (text.includes('暂不支持搜索'))
      return fail('搜索接口已被源站关闭：HTTP 200 + "暂不支持搜索"');

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const html = /^\s*</.test(text) || type.includes('html');
      return fail(
        html
          ? '源站返回 HTML 而非 JSON'
          : `返回内容不是 JSON（${type || '无 content-type'}）`,
      );
    }
    if (!Array.isArray(data?.list)) return fail('返回 JSON 但缺少 list 字段');

    return {
      ...base,
      ok: true,
      ms,
      status: res.status,
      results: data.list.length,
      total: Number(data.total) || data.list.length,
      sample: data.list[0]?.vod_name || '',
    };
  } catch (err) {
    const ms = Date.now() - started;
    const reason =
      err?.name === 'TimeoutError'
        ? `超时（>${TIMEOUT} ms）`
        : `DNS/连接失败（${err?.cause?.code || err?.message || err}）`;
    return { ...base, ok: false, ms, status: 0, reason };
  }
}

const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, entries.length) }, async () => {
    while (next < entries.length) {
      const i = next++;
      results[i] = await probe(entries[i]);
    }
  }),
);

if (flag('ok-json')) {
  const ok = Object.fromEntries(
    results.filter((r) => r.ok).map((r) => [r.key, sites[r.key]]),
  );
  console.log(JSON.stringify(ok, null, 2));
} else if (flag('json')) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const today = new Date().toISOString().slice(0, 10);
  for (const r of results) {
    const tag = r.ok ? 'OK  ' : 'FAIL';
    const state = r.disabled ? ' [disabled]' : '';
    const detail = r.ok
      ? `${r.results} 条（共 ${r.total}）${r.sample ? ` 例：${r.sample}` : ''}`
      : `${r.reason}，暂不可用（${today} 实测）`;
    console.log(
      `${tag} ${r.key.padEnd(20)} ${String(r.ms).padStart(5)}ms  ${r.name}${state}  ${detail}`,
    );
  }
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} 可用，关键词「${WD}」`);
  const revive = results.filter((r) => r.ok && r.disabled).map((r) => r.key);
  const broken = results.filter((r) => !r.ok && !r.disabled).map((r) => r.key);
  if (revive.length)
    console.log(`已 disabled 但现在可用（可考虑恢复）：${revive.join(', ')}`);
  if (broken.length)
    console.log(
      `启用中但不可用（可考虑加 disabled + note）：${broken.join(', ')}`,
    );
}

process.exit(results.every((r) => r.ok) ? 0 : 1);
