/**
 * Mock Apple CMS V10 API + HLS origin for e2e / perf testing.
 *
 * Serves:
 *   /cms/<siteKey>/provide/vod?ac=videolist&wd=<q>[&pg=N]   search
 *   /cms/<siteKey>/provide/vod?ac=videolist&ids=<id>       detail
 *   /media/<quality>/master.m3u8, /media/<quality>/v0.m3u8, /media/<quality>/seg_NNN.ts
 *   /__sites                                               site table
 *   /__hits?wd=<q>                                         which sites were queried for a keyword
 *   /__reset                                               clear the /__hits log
 *
 * Latency/bandwidth knobs make the "slow source" scenario reproducible:
 *   CMS_SITES=slow:2500,fast:80,mid:600,...   (per-site delay in ms)
 *   BANDWIDTH_KBPS=...                          (per-segment throttle)
 *
 * Detail fixtures: `fast` returns a messy, entity-padded two-paragraph synopsis
 * and a Douban id; `mid` a short synopsis and no Douban id (DESCS / DOUBAN_IDS
 * below, used by test_play_details.py). Every other site gets a one-liner.
 *
 * The /__hits log is what lets test_av_filter.mjs assert that a request
 * (e.g. search suggestions, which only ever queries the *first* available
 * source) skipped the adult sources instead of merely returning fewer
 * results. See tests/e2e/README.md.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.join(__dirname, 'media');
const PORT = Number(process.env.MOCK_PORT || 4010);

// siteKey -> artificial delay (ms). Default: everything fast unless overridden.
const SITE_DELAYS = Object.fromEntries(
  (process.env.CMS_SITES || 'fast:60').split(',').map((p) => {
    const [k, v] = p.split(':');
    return [k, Number(v)];
  })
);

const BANDWIDTH_KBPS = Number(process.env.BANDWIDTH_KBPS || 0); // 0 = unthrottled
const MOVIE_TITLE = process.env.MOVIE_TITLE || '测试影片 Test Movie';
const MOVIE_YEAR = process.env.MOVIE_YEAR || '2024';
const EPISODES = Number(process.env.EPISODES || 12);

/** Per-site quality mapping so sources are distinguishable in the panel. */
const SITE_QUALITY = JSON.parse(
  process.env.SITE_QUALITY || '{"fast":"720p"}'
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Search fan-out recorder. `/api/search/suggestions` only queries the first
 * available source, so "did the AV filter actually prevent the adult source
 * from being queried?" is observable from the CMS side but not from the app
 * response. Every `/cms/<key>/...wd=` hit is appended here.
 */
const HITS = []; // { site, wd, ids, at }

function siteKeys() {
  return Object.keys(SITE_DELAYS);
}

function episodesFor(siteKey) {
  const q = SITE_QUALITY[siteKey] || '720p';
  const out = [];
  for (let i = 1; i <= EPISODES; i++) {
    out.push(
      `第${i}集$${baseUrl()}/media/${q}/master.m3u8#${i}`
    );
  }
  return out.join('#');
}

let _baseUrl = null;
function baseUrl() {
  if (!_baseUrl) _baseUrl = `http://127.0.0.1:${PORT}`;
  return _baseUrl;
}

/**
 * Per-site vod_content. `fast` mimics what real CMS sources send: a long
 * two-paragraph synopsis in <p> tags, indented and padded with runs of
 * `&nbsp;` (some double-encoded as `&amp;nbsp;`) — see test_play_details.py.
 * `mid` is short enough that the play page must not show a "read more" toggle.
 */
const LONG_DESC =
  '<p>对这个世界充满瑰丽幻想的高中女生佐仓七濑（上白石萌音 饰），在东京修学旅途中遇到了命中注定的那个男人。' +
  '她偶然目击了医生天堂浬（佐藤健 饰）抢救生病路人的紧张场面，由此对天堂一见钟情。' +
  '在此之后，她坚定目标，发愤图强，终于在五年后成为一名护士。' +
  '更令她欣喜非常的是，七濑入院来到天堂浬所在的日浦综合医院上班。' +
  '然而希望有多大，失望就有多大。天堂早就忘了眼前这个平凡的路人，' +
  '而且医院中的他仿佛严厉的恶鬼，对待新人完全没有任何优待和宽容。' +
  '七濑和同期们稍有差错就会遭到一连串暴风雨般的痛骂，甚至被骂到怀疑人生。' +
  '也许爱情就是这样，总要近距离去感受它的甜蜜和粗粝……</p>' +
  '<p>&nbsp;&nbsp;另一方面，天堂浬的过去也渐渐浮出水面。五年前，他曾因一场失败的手术失去了最重要的人，' +
  '从此把自己封闭在冷酷的外壳之下。七濑的一次次莽撞与坚持，让他不得不重新面对那段不愿提起的往事。' +
  '在日浦综合医院这个生死交错的地方，两人在一次次急救、值班与争吵中慢慢靠近。' +
  '恋爱与成长，究竟哪一个会先到来？这是一部关于梦想、勇气与初心的医疗爱情剧。' +
  ' &nbsp;'.repeat(30) +
  ' &amp;nbsp;'.repeat(10) +
  '</p>';
const DESCS = {
  fast: LONG_DESC,
  mid: '<p>短简介&nbsp;&nbsp;。</p>',
};
/**
 * Only `fast` carries a Douban id, so the play page renders the 豆瓣 button
 * (and asks /api/douban/subject for its rating — mocked by the browser suite).
 */
const DOUBAN_IDS = { fast: 1292052 };

function vodItem(siteKey, id) {
  const q = SITE_QUALITY[siteKey] || '720p';
  return {
    vod_id: id,
    vod_name: MOVIE_TITLE,
    vod_pic: `${baseUrl()}/poster.svg`,
    vod_year: MOVIE_YEAR,
    type_name: '剧情',
    vod_class: '剧情',
    vod_content: DESCS[siteKey] || '用于 e2e 与性能回归测试的本地影片。',
    vod_douban_id: DOUBAN_IDS[siteKey] || 0,
    vod_play_url: episodesFor(siteKey),
    vod_play_from: siteKey,
  };
}

function send(res, status, body, headers = {}) {
  const isBinary = Buffer.isBuffer(body);
  const payload = isBinary
    ? body
    : typeof body === 'string'
    ? body
    : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBinary
      ? 'application/octet-stream'
      : 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    ...headers,
  });
  res.end(payload);
}

async function throttle(buf) {
  if (!BANDWIDTH_KBPS) return buf;
  const bytesPerMs = (BANDWIDTH_KBPS * 1024) / 1000;
  const chunks = [];
  for (let i = 0; i < buf.length; i += Math.max(1, Math.floor(bytesPerMs))) {
    chunks.push(buf.subarray(i, i + Math.max(1, Math.floor(bytesPerMs))));
    await sleep(1);
  }
  return Buffer.concat(chunks);
}

const MIME = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  // CODEC=vp9 fixtures (make-media.sh): fMP4 init segment + media segments.
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, baseUrl());
  const p = url.pathname;

  // ---- CMS API -------------------------------------------------------------
  const cms = p.match(/^\/cms\/([^/]+)\/provide\/vod$/);
  if (cms) {
    const siteKey = cms[1];
    const delay = SITE_DELAYS[siteKey] ?? 60;
    await sleep(delay); // simulate upstream latency

    const ac = url.searchParams.get('ac');
    const ids = url.searchParams.get('ids');
    const wd = url.searchParams.get('wd');
    const pg = Number(url.searchParams.get('pg') || 1);

    if (ac !== 'videolist') return send(res, 200, { code: 1, msg: 'ok' });

    // Record the fan-out so tests can assert which sources were consulted.
    HITS.push({ site: siteKey, wd: wd || null, ids: ids || null, at: Date.now() });
    if (HITS.length > 500) HITS.shift();

    // Detail lookup
    if (ids) {
      return send(res, 200, {
        code: 1,
        msg: '数据列表',
        page: 1,
        pagecount: 1,
        limit: 1,
        total: 1,
        list: [vodItem(siteKey, ids)],
      });
    }

    // Search. Only `fast` answers page 1 immediately for the test query;
    // the others answer page 1 too so the baseline N-way fan-out is realistic.
    if (wd) {
      if (pg > 1) {
        return send(res, 200, {
          code: 1,
          msg: '数据列表',
          page: pg,
          pagecount: 1,
          limit: 0,
          total: 0,
          list: [],
        });
      }
      return send(res, 200, {
        code: 1,
        msg: '数据列表',
        page: 1,
        pagecount: 1,
        limit: 1,
        total: 1,
        list: [vodItem(siteKey, `${siteKey}-1`)],
      });
    }

    return send(res, 200, { code: 1, msg: 'ok', list: [] });
  }

  // ---- Media ---------------------------------------------------------------
  if (p.startsWith('/media/')) {
    const file = path.join(MEDIA_DIR, p.replace('/media/', ''));
    if (!file.startsWith(MEDIA_DIR) || !fs.existsSync(file)) {
      return send(res, 404, { error: 'not found' });
    }
    const ext = path.extname(file);
    let body = fs.readFileSync(file);
    if (BANDWIDTH_KBPS) body = await throttle(body);
    return send(res, 200, body, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
    });
  }

  if (p === '/poster.svg') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#b8562f"/><text x="150" y="220" font-family="sans-serif" font-size="26" fill="#fff" text-anchor="middle">测试影片</text></svg>`;
    return send(res, 200, svg, { 'Content-Type': 'image/svg+xml' });
  }

  if (p === '/__sites') {
    return send(res, 200, { sites: siteKeys(), delays: SITE_DELAYS, quality: SITE_QUALITY });
  }

  // ---- Fan-out introspection (used by the AV filter tests) ----------------
  // GET /__hits[?wd=<q>] -> { hits: [...] } filtered by keyword when given.
  if (p === '/__hits') {
    const wd = url.searchParams.get('wd');
    const hits = wd ? HITS.filter((h) => h.wd === wd) : HITS;
    return send(res, 200, { hits, sites: siteKeys() });
  }

  // /__reset -> clear the hit log so the next assertion sees only its own
  // request (the app fires background requests we do not control).
  // Any HTTP verb works; curl/Playwright can use GET for convenience.
  if (p === '/__reset') {
    HITS.length = 0;
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'not found', path: p });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[mock-cms] listening on ${baseUrl()} sites=${JSON.stringify(SITE_DELAYS)} quality=${JSON.stringify(SITE_QUALITY)} bw=${BANDWIDTH_KBPS || 'unthrottled'}KB/s`
  );
});
