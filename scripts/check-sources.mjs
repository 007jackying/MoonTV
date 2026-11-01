#!/usr/bin/env node
/**
 * 实测 config.json 里的采集源是否可用。
 *
 * 搜索请求与站内搜索完全相同：`<api>?ac=videolist&wd=<关键词>`，
 * UA / Accept 与 src/lib/config.ts 的 API_CONFIG.search.headers 一致。
 * 默认每个源只发这一次请求；加 --play 才会继续请求分集播放列表（见下）。
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
 * 端到端（搜索 → 分集 → m3u8）：加 --play
 *   搜索通过后，按站内 parseEpisodes（src/lib/downstream.ts）同样的规则解析出
 *   .m3u8 分集，再真正请求第一集的播放列表（主列表会再跟进一层子列表），
 *   确认返回的是 #EXTM3U 且含分片。搜索结果为空时改用最新列表（?ac=videolist）；
 *   有结果但都没有 .m3u8 分集时直接判失败——站内搜到的就是这些结果。
 *   注意：脚本在服务端发请求，不受浏览器 CORS 限制；个别源在浏览器里仍可能
 *   因 CORS 无法测速，但能播放。
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
const PLAY = flag('play');

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
    console.error(
      `${path.basename(CONFIG)} 里没有这些 key：${unknown.join(', ')}`,
    );
    process.exit(2);
  }
  entries = entries.filter(([k]) => keys.includes(k));
}
if (flag('enabled')) entries = entries.filter(([, s]) => s.disabled !== true);
if (flag('disabled')) entries = entries.filter(([, s]) => s.disabled === true);

/** 与 Response.json() 一致：去掉 UTF-8 BOM 再解析（部分 CMS 会带 BOM） */
const parseJson = (text) => JSON.parse(text.replace(/^\uFEFF/, ''));

const M3U8_PATTERN = /(https?:\/\/[^"'\s]+?\.m3u8)/g;

/** 与 src/lib/downstream.ts 的 parseEpisodes 保持一致：只认 .m3u8 结尾的分集 */
function parseEpisodes(playUrl, fallbackContent) {
  let episodes = [];
  for (const source of (playUrl || '').split('$$$')) {
    const current = source
      .split('#')
      .map((entry) => entry.split('$')[1])
      .filter((url) => url?.endsWith('.m3u8'));
    if (current.length > episodes.length) episodes = current;
  }
  if (episodes.length === 0 && fallbackContent) {
    episodes = (fallbackContent.match(M3U8_PATTERN) ?? []).map((l) =>
      l.replace(/^\$/, ''),
    );
  }
  return episodes;
}

async function getText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': HEADERS['User-Agent'] },
    signal: AbortSignal.timeout(TIMEOUT),
    redirect: 'follow',
  });
  return { res, text: res.ok ? await res.text() : '' };
}

/** 可播放时返回 { title, m3u8 }，否则返回 { reason, m3u8? } */
async function checkPlayable(site, list) {
  let items = list;
  if (items.length === 0) {
    try {
      const { res, text } = await getText(site.api + '?ac=videolist');
      items = res.ok ? parseJson(text)?.list || [] : [];
    } catch {
      items = [];
    }
  }
  const item = items.find(
    (it) => parseEpisodes(it.vod_play_url, it.vod_content).length,
  );
  if (!item)
    return {
      reason: '搜索可用，但解析不出 .m3u8 分集（站内会显示 0 集，无法播放）',
    };
  const m3u8 = parseEpisodes(item.vod_play_url, item.vod_content)[0];
  try {
    let { res, text } = await getText(m3u8);
    if (!res.ok) return { reason: `m3u8 返回 HTTP ${res.status}`, m3u8 };
    if (!text.trimStart().startsWith('#EXTM3U'))
      return { reason: 'm3u8 内容不是 HLS 播放列表', m3u8 };
    if (text.includes('#EXT-X-STREAM-INF')) {
      const variant = text
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith('#'));
      if (!variant) return { reason: '主播放列表里没有子列表', m3u8 };
      ({ res, text } = await getText(new URL(variant, res.url || m3u8).href));
      if (!res.ok) return { reason: `子播放列表返回 HTTP ${res.status}`, m3u8 };
    }
    if (!text.includes('#EXTINF'))
      return { reason: '播放列表里没有分片', m3u8 };
    return { title: item.vod_name, m3u8 };
  } catch (err) {
    return {
      reason:
        err?.name === 'TimeoutError'
          ? `m3u8 超时（>${TIMEOUT} ms）`
          : `m3u8 连接失败（${err?.cause?.code || err?.message || err}）`,
      m3u8,
    };
  }
}

async function probe(entry) {
  const r = await probeSearch(entry);
  if (!PLAY || !r.ok) return r;
  const play = await checkPlayable(entry[1], r.list);
  const { list: _list, ...rest } = r;
  return play.reason
    ? {
        ...rest,
        ok: false,
        searchOk: true,
        reason: play.reason,
        m3u8: play.m3u8,
      }
    : { ...rest, played: play.title, m3u8: play.m3u8 };
}

async function probeSearch([key, site]) {
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

    let data;
    try {
      data = parseJson(text);
    } catch {
      if (text.includes('暂不支持搜索'))
        return fail('搜索接口已被源站关闭：HTTP 200 + "暂不支持搜索"');
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
      list: PLAY ? data.list : undefined,
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
      ? r.played
        ? `搜索 ${r.results} 条，可播放：${r.played}`
        : `${r.results} 条（共 ${r.total}）${r.sample ? ` 例：${r.sample}` : ''}`
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
