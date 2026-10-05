#!/usr/bin/env node
/**
 * API-level e2e for the global AV-source filter.
 *
 * Covers the server half of the feature end to end against a real `next dev`
 * server booted with the `avfilter` profile (see serve.mjs):
 *
 *   1. /api/search           AV results are dropped when filterAdult=1, and
 *                            still returned without the parameter (so the test
 *                            is not vacuous)
 *   2. /api/search fan-out   the adult sources are never even queried, checked
 *                            via the mock CMS /__hits log rather than only by
 *                            looking at the response
 *   3. /api/search/one       a single-source lookup on an AV source 404s while
 *                            filtering, and succeeds while not filtering
 *   4. /api/detail           same for the manual detail load
 *   5. /api/search/suggestions
 *                            suggestions only ever query the FIRST available
 *                            source; the profile puts an adult source first so
 *                            this is observable
 *   6. /api/config/sources   the raw list stays complete (it is a cached,
 *                            preference-independent endpoint) — the client
 *                            trims it, see config.client.ts
 *
 * Usage:
 *   node tests/e2e/serve.mjs --profile=avfilter     # in one shell
 *   node tests/e2e/test_av_filter.mjs               # in another
 *
 * No test framework: plain assertions, non-zero exit on failure, so it drops
 * into CI without extra config.
 */

const APP = process.env.E2E_URL || 'http://127.0.0.1:4020';
const CMS = process.env.E2E_CMS_URL || 'http://127.0.0.1:4010';
const PASSWORD = process.env.E2E_PASSWORD || '111111';

// The mock serves every site under this single title/year (mock-cms.mjs).
const QUERY = '测试影片 Test Movie';

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  ok(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`
  );
}

const isAv = (name) => /^AV[\s\-_]/i.test(name || '');

/** Cookie header from a successful login, so auth-gated modes work too. */
async function login() {
  const res = await fetch(`${APP}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
  return cookie;
}

/** Sources the mock CMS was actually asked to query. */
async function cmsHits(wd) {
  const res = await fetch(`${CMS}/__hits${wd ? `?wd=${encodeURIComponent(wd)}` : ''}`);
  const body = await res.json();
  return [...new Set(body.hits.map((h) => h.site))];
}

async function cmsReset() {
  await fetch(`${CMS}/__reset`);
}

/** GET an app API path. `qs` is a plain object; array values repeat the key. */
async function api(path, qs = {}, cookie = '') {
  const url = new URL(path, APP);
  for (const [k, v] of Object.entries(qs)) {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
    else url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: cookie ? { cookie } : {},
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* stream endpoints return NDJSON/SSE; callers only need res.ok */
  }
  return { res, body };
}

/** Names of the distinct sources present in a /api/search response. */
const sourceNames = (results) => [
  ...new Set((results || []).map((r) => r.source_name)),
];

async function main() {
  console.log(`AV filter e2e → app=${APP} cms=${CMS}`);
  const cookie = await login();

  // Guard: the profile must actually contain adult sources, otherwise every
  // assertion below passes trivially.
  const { body: allSources } = await api('/api/config/sources', {}, cookie);
  const avSources = (allSources || []).filter((s) => s.is_adult || isAv(s.name));
  ok(
    'profile contains adult sources (test is not vacuous)',
    avSources.length >= 2,
    `found ${avSources.length}`
  );
  const nonAvSources = (allSources || []).filter(
    (s) => !s.is_adult && !isAv(s.name)
  );
  ok(
    'profile contains non-adult sources',
    nonAvSources.length >= 2,
    `found ${nonAvSources.length}`
  );
  if (avSources.length < 2 || nonAvSources.length < 2) {
    console.error('\nBoot with: node tests/e2e/serve.mjs --profile=avfilter');
    process.exit(2);
  }

  // --- 1. /api/search, streaming off (deterministic ordering) --------------
  console.log('\n/api/search (non-stream)');
  const noFilter = await api(
    '/api/search',
    { q: QUERY, stream: 0, timeout: 30 },
    cookie
  );
  const unfilteredNames = sourceNames(noFilter.body?.results);
  ok(
    'without filterAdult the adult sources are searched',
    unfilteredNames.some(isAv),
    `source_name values: ${JSON.stringify(unfilteredNames)}`
  );

  const filtered = await api(
    '/api/search',
    { q: QUERY, stream: 0, timeout: 30, filterAdult: 1 },
    cookie
  );
  eq(
    'with filterAdult=1 no result comes from an adult source',
    sourceNames(filtered.body?.results).filter(isAv),
    []
  );
  ok(
    'with filterAdult=1 the normal sources still return results',
    filtered.body?.results?.length > 0,
    `got ${filtered.body?.results?.length ?? 0} results`
  );

  // The is_adult-flag source is named "e2e-flagged" (no AV- prefix), so it can
  // only be excluded by the flag path, not by name matching.
  const flaggedKey = allSources.find(
    (s) => s.is_adult && !isAv(s.name)
  )?.key;
  ok(
    'flag-only adult source (no AV- prefix) is filtered too',
    !!flaggedKey &&
      !sourceNames(filtered.body?.results).includes(
        allSources.find((s) => s.key === flaggedKey)?.name
      ),
    `flagged source key=${flaggedKey}`
  );

  // --- 2. the adult sources are never even queried --------------------------
  console.log('\n/api/search fan-out (mock CMS /__hits)');
  await cmsReset();
  await api('/api/search', { q: QUERY, stream: 0, timeout: 30, filterAdult: 1 }, cookie);
  const hitsFiltered = await cmsHits(QUERY);
  ok(
    'filterAdult=1 → no adult source was queried',
    !hitsFiltered.some((k) => avSources.some((s) => s.key === k)),
    `queried: ${JSON.stringify(hitsFiltered)}`
  );

  await cmsReset();
  await api('/api/search', { q: QUERY, stream: 0, timeout: 30 }, cookie);
  const hitsUnfiltered = await cmsHits(QUERY);
  ok(
    'no filterAdult → adult sources are queried',
    hitsUnfiltered.some((k) => avSources.some((s) => s.key === k)),
    `queried: ${JSON.stringify(hitsUnfiltered)}`
  );

  // --- 3. explicitly selecting an AV source via `sources=` -------------------
  // The saved-source list in localStorage can still contain AV keys; the
  // request-level filter has to win over the caller's selection.
  console.log('\n/api/search with sources=<adult key>');
  const avKey = avSources[0].key;
  const forced = await api(
    '/api/search',
    { q: QUERY, stream: 0, timeout: 30, sources: avKey, filterAdult: 1 },
    cookie
  );
  eq(
    'forcing an AV source is overridden by filterAdult=1',
    forced.body?.results,
    []
  );

  // --- 4. /api/search/one ----------------------------------------------------
  console.log('\n/api/search/one');
  const oneUnfiltered = await api(
    '/api/search/one',
    { q: QUERY, resourceId: avKey, timeout: 30 },
    cookie
  );
  ok(
    'without filterAdult an AV source resolves',
    oneUnfiltered.res.ok && Array.isArray(oneUnfiltered.body?.results),
    `status=${oneUnfiltered.res.status}`
  );
  const oneFiltered = await api(
    '/api/search/one',
    { q: QUERY, resourceId: avKey, timeout: 30, filterAdult: 1 },
    cookie
  );
  ok(
    'with filterAdult=1 an AV resourceId is rejected',
    oneFiltered.res.status === 404,
    `status=${oneFiltered.res.status}`
  );

  // --- 5. /api/detail --------------------------------------------------------
  console.log('\n/api/detail');
  const detailUnfiltered = await api(
    '/api/detail',
    { source: avKey, id: `${avKey}-1` },
    cookie
  );
  ok(
    'without filterAdult an AV detail loads',
    detailUnfiltered.res.ok && !!detailUnfiltered.body?.episodes?.length,
    `status=${detailUnfiltered.res.status}`
  );
  const detailFiltered = await api(
    '/api/detail',
    { source: avKey, id: `${avKey}-1`, filterAdult: 1 },
    cookie
  );
  ok(
    'with filterAdult=1 an AV source is an invalid source',
    detailFiltered.res.status === 400,
    `status=${detailFiltered.res.status} body=${JSON.stringify(detailFiltered.body)}`
  );

  // --- 6. /api/search/suggestions (first-source-only fan-out) ----------------
  console.log('\n/api/search/suggestions');
  // The mock returns titles derived from MOVIE_TITLE, so any suggestion request
  // records a /cms hit whose wd we can look up.
  const SUGGEST_Q = '测试影片';
  await cmsReset();
  await api('/api/search/suggestions', { q: SUGGEST_Q }, cookie);
  const sugUnfiltered = await cmsHits(SUGGEST_Q);
  ok(
    'without filterAdult suggestions use the first source (an adult one here)',
    sugUnfiltered.length === 1 && avSources.some((s) => s.key === sugUnfiltered[0]),
    `queried: ${JSON.stringify(sugUnfiltered)}`
  );

  await cmsReset();
  await api(
    '/api/search/suggestions',
    { q: SUGGEST_Q, filterAdult: 1 },
    cookie
  );
  const sugFiltered = await cmsHits(SUGGEST_Q);
  ok(
    'with filterAdult=1 suggestions skip the adult first source',
    sugFiltered.length === 1 && !avSources.some((s) => s.key === sugFiltered[0]),
    `queried: ${JSON.stringify(sugFiltered)}`
  );

  // --- 7. /api/config/sources stays preference-independent -------------------
  console.log('\n/api/config/sources');
  const withParam = await api(
    '/api/config/sources',
    { filterAdult: 1 },
    cookie
  );
  eq(
    'the endpoint ignores filterAdult (client trims it; keeps the response cacheable)',
    (withParam.body || []).length,
    (allSources || []).length
  );

  // --- 8. explicit filterAdult=0 --------------------------------------------
  console.log('\n/api/search filterAdult=0');
  const off = await api(
    '/api/search',
    { q: QUERY, stream: 0, timeout: 30, filterAdult: 0 },
    cookie
  );
  ok(
    'filterAdult=0 keeps adult sources (toggle off round-trips)',
    sourceNames(off.body?.results).some(isAv),
    `source_name values: ${JSON.stringify(sourceNames(off.body?.results))}`
  );

  // --- report ----------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('\nFailures:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n[e2e] test harness error:', err);
  console.error(
    'Is the harness running?  node tests/e2e/serve.mjs --profile=avfilter'
  );
  process.exit(2);
});