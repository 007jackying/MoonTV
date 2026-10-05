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

function vodItem(siteKey, id) {
  const q = SITE_QUALITY[siteKey] || '720p';
  return {
    vod_id: id,
    vod_name: MOVIE_TITLE,
    vod_pic: `${baseUrl()}/poster.svg`,
    vod_year: MOVIE_YEAR,
    type_name: '剧情',
    vod_class: '剧情',
    vod_content: '用于 e2e 与性能回归测试的本地影片。',
    vod_douban_id: 0,
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
