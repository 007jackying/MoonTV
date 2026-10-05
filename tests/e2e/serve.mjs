#!/usr/bin/env node
/**
 * Boot harness for e2e / perf runs.
 *
 * 1. starts the mock CMS + HLS origin (tests/e2e/mock-cms.mjs)
 * 2. swaps config.json for a mock-only one and regenerates src/lib/runtime.ts
 *    (both restored on exit, always)
 * 3. starts `next dev`
 *
 * NB: we deliberately do NOT use DOCKER_ENV=true. Every route is
 * `runtime = 'edge'`, and config.ts:146 does eval('require')('fs') in that
 * branch, which throws "Native module not found: fs" on the edge runtime.
 * Baking runtime.ts is the supported path.
 *
 * Usage:
 *   node tests/e2e/serve.mjs                        # perf profile (default)
 *   node tests/e2e/serve.mjs --profile=avfilter     # adds adult (AV-*) sources
 *
 * Profiles only differ in the api_site table written to config.json; see
 * PROFILES below and tests/e2e/README.md.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CONFIG = path.join(ROOT, 'config.json');
const RUNTIME = path.join(ROOT, 'src/lib/runtime.ts');
const BACKUP = path.join(ROOT, '.e2e-backup');

const APP_PORT = Number(process.env.E2E_PORT || 4020);
const MOCK_PORT = Number(process.env.MOCK_PORT || 4010);

/**
 * Source profiles. `key -> { delay, quality, name, is_adult? }`:
 *   delay    artificial upstream latency in ms (makes the "slow source" case
 *            reproducible; slow2 at 4s dominates baseline time-to-first-frame)
 *   quality  HLS ladder served by /media/<quality>
 *   name     written to config.json, i.e. what the UI shows. Adult sources are
 *            recognised by the `AV-` name prefix and/or the `is_adult` flag.
 *   is_adult written to config.json so the flag path (not just the name
 *            prefix) is exercised.
 *
 * The `avfilter` profile deliberately puts an adult source FIRST: search
 * suggestions only ever query the first available source, so that ordering is
 * what makes the AV filter observable on the suggestions route.
 */
const PROFILES = {
  perf: {
    fast: { delay: 60, quality: '720p', name: 'E2E-fast' },
    mid: { delay: 600, quality: '1080p', name: 'E2E-mid' },
    slow1: { delay: 2500, quality: '720p', name: 'E2E-slow1' },
    slow2: { delay: 4000, quality: '1080p', name: 'E2E-slow2' },
    dead: { delay: 1500, quality: '720p', name: 'E2E-dead' },
  },
  avfilter: {
    // adult source first on purpose (see comment above)
    avfirst: { delay: 40, quality: '720p', name: 'AV-e2e-first' },
    // adult via the is_adult flag only, name has no AV- prefix: proves the
    // flag is plumbed through config.ts and not just name-matched
    avflag: { delay: 40, quality: '720p', name: 'e2e-flagged', is_adult: true },
    fast: { delay: 60, quality: '720p', name: 'E2E-fast' },
    mid: { delay: 600, quality: '1080p', name: 'E2E-mid' },
  },
};

/** Build output dir for the harness run (see next.config.js distDir). */
const DIST_DIR = process.env.NEXT_DIST_DIR || '.next-e2e';

const PROFILE_NAME =
  (process.argv.find((a) => a.startsWith('--profile=')) || '').split('=')[1] ||
  process.env.E2E_PROFILE ||
  'perf';

if (!PROFILES[PROFILE_NAME]) {
  console.error(
    `[e2e] unknown profile "${PROFILE_NAME}" (known: ${Object.keys(PROFILES).join(', ')})`
  );
  process.exit(2);
}
const SITES = PROFILES[PROFILE_NAME];

const MODE = process.argv.includes('--build') ? 'build' : 'dev';
const PASSWORD = process.env.E2E_PASSWORD || '111111';

const procs = [];
let restored = false;

// Paths swapped out of the repo, kept relative so cleanup can put each one back
// where it came from. (Using basename here would restore src/lib/runtime.ts as
// ./runtime.ts and silently leave the generated file behind.)
const SWAPPED = ['config.json', 'src/lib/runtime.ts'];

function cleanup() {
  if (restored) return;
  restored = true;
  for (const p of procs) {
    try {
      p.kill('SIGTERM');
    } catch {}
  }
  if (fs.existsSync(BACKUP)) {
    for (const rel of SWAPPED) {
      const saved = path.join(BACKUP, rel);
      if (fs.existsSync(saved)) {
        fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true });
        fs.copyFileSync(saved, path.join(ROOT, rel));
      }
    }
    fs.rmSync(BACKUP, { recursive: true, force: true });
    console.log(`[e2e] restored ${SWAPPED.join(' + ')}`);
  }
  if (DIST_DIR !== '.next' && !fs.existsSync(path.join(ROOT, DIST_DIR, '.keep'))) {
    // The e2e build dir is disposable; drop it so runs start from scratch.
    fs.rmSync(path.join(ROOT, DIST_DIR), { recursive: true, force: true });
    console.log(`[e2e] removed ${DIST_DIR}/`);
  }
}

for (const sig of ['SIGINT', 'SIGTERM', 'exit', 'uncaughtException']) {
  process.on(sig, () => {
    cleanup();
    if (sig !== 'exit') process.exit(1);
  });
}

// Parent-death watchdog. If this process is SIGKILLed it cannot clean up, which
// would leave `next dev` holding the port and the swapped config.json in place.
// Children get reparented to init when the parent dies, so a ppid of 1 means
// "nobody is driving me any more".
const originalParent = process.ppid;
setInterval(() => {
  if (process.ppid !== originalParent && process.ppid === 1) {
    console.error('[e2e] parent process gone, shutting down');
    cleanup();
    process.exit(1);
  }
}, 2000).unref();

// Refuse to start on top of a harness that is already up: booting twice would
// restore the *mock* config over the real one (the second process snapshots
// config.json after the first already swapped it).
for (const [label, port] of [['app', APP_PORT], ['mock', MOCK_PORT]]) {
  const busy = spawnSync(
    process.execPath,
    [
      '-e',
      `const s=require('net').connect(${port},'127.0.0.1',()=>{s.end();process.exit(0)});` +
        `s.on('error',()=>process.exit(1));s.setTimeout(500,()=>process.exit(1));`,
    ],
    { stdio: 'ignore' }
  );
  if (busy.status === 0) {
    console.error(
      `[e2e] ${label} port ${port} is already in use. ` +
        `Stop the running harness first (it owns the config.json swap).`
    );
    process.exit(2);
  }
}

// --- 1. swap config ---------------------------------------------------------
fs.mkdirSync(path.join(BACKUP, 'src/lib'), { recursive: true });
for (const rel of SWAPPED) {
  const from = path.join(ROOT, rel);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, path.join(BACKUP, rel));
  }
}

const mockConfig = {
  cache_time: 7200,
  api_site: Object.fromEntries(
    Object.entries(SITES).map(([k, s]) => [
      k,
      {
        api: `http://127.0.0.1:${MOCK_PORT}/cms/${k}/provide/vod`,
        name: s.name,
        // Only emit the key when set, so the perf profile's config.json stays
        // byte-identical to what it was before adult-source support existed.
        ...(s.is_adult ? { is_adult: true } : {}),
      },
    ])
  ),
  custom_category: [],
};
fs.writeFileSync(CONFIG, JSON.stringify(mockConfig, null, 2));
spawn('node', [path.join(ROOT, 'scripts/generate-runtime.js')], {
  cwd: ROOT,
  stdio: 'inherit',
});
const adultKeys = Object.entries(SITES)
  .filter(([, s]) => s.is_adult || /^AV[\s\-_]/i.test(s.name))
  .map(([k]) => k);
console.log(
  `[e2e] wrote mock config.json profile=${PROFILE_NAME} ` +
    `(${Object.keys(SITES).length} sources, adult: ${
      adultKeys.join(',') || 'none'
    }) + runtime.ts`
);

// --- 2. mock CMS ------------------------------------------------------------
const mock = spawn('node', [path.join(__dirname, 'mock-cms.mjs')], {
  env: {
    ...process.env,
    CMS_SITES: Object.entries(SITES)
      .map(([k, s]) => `${k}:${s.delay}`)
      .join(','),
    SITE_QUALITY: JSON.stringify(
      Object.fromEntries(Object.entries(SITES).map(([k, s]) => [k, s.quality]))
    ),
    MOCK_PORT: String(MOCK_PORT),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
mock.stdout.on('data', (d) => process.stdout.write(`[cms] ${d}`));
mock.stderr.on('data', (d) => process.stderr.write(`[cms!] ${d}`));
procs.push(mock);

// --- 3. next ---------------------------------------------------------------
// NB: use the local binary directly. `pnpm exec next` hangs in this context.
const nextBin = path.join(ROOT, 'node_modules', '.bin', 'next');
// Own build directory, so a harness run never shares on-demand-compile manifests
// with a `next dev` the developer already has running (see NEXT_DIST_DIR above).
const nextEnv = {
  ...process.env,
  PASSWORD,
  NEXT_PUBLIC_STORAGE_TYPE: 'localstorage',
  NEXT_DIST_DIR: DIST_DIR,
  CF_PAGES: '',
  CLOUDFLARE_PAGES: '',
};

function pipe(label, proc) {
  proc.stdout.on('data', (d) => process.stdout.write(`[${label}] ${d}`));
  proc.stderr.on('data', (d) => process.stderr.write(`[${label}!] ${d}`));
  procs.push(proc);
  return proc;
}

/**
 * `--build` has to build first and *then* serve: `next build` ignores -H/-p and
 * exits when it is done, so passing it straight through would leave the harness
 * with no server at all.
 */
async function startNext() {
  if (MODE !== 'build') {
    pipe('next', spawn(nextBin, ['dev', '-H', '127.0.0.1', '-p', String(APP_PORT)], {
      cwd: ROOT,
      env: nextEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    return;
  }

  console.log('[e2e] building (next build) ...');
  const code = await new Promise((resolve) => {
    const b = spawn(nextBin, ['build'], {
      cwd: ROOT,
      env: nextEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    pipe('build', b);
    b.on('exit', resolve);
    b.on('error', () => resolve(1));
  });
  if (code !== 0) {
    console.error(`[e2e] next build failed (exit ${code})`);
    process.exit(1);
  }
  pipe('next', spawn(nextBin, ['start', '-H', '127.0.0.1', '-p', String(APP_PORT)], {
    cwd: ROOT,
    env: nextEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

// --- 4. wait for readiness (with auth) --------------------------------------
const appUrl = `http://127.0.0.1:${APP_PORT}`;

async function ready() {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      const login = await fetch(`${appUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: PASSWORD }),
      });
      const cookie = (login.headers.getSetCookie?.() ?? [])
        .map((c) => c.split(';')[0])
        .join('; ');
      const r = await fetch(`${appUrl}/api/config/sources`, {
        headers: { cookie },
      });
      if (r.ok) {
        const body = await r.json();
        const n = Array.isArray(body) ? body.length : Object.keys(body).length;
        console.log(
          `\n[e2e] READY profile=${PROFILE_NAME} app=${appUrl} ` +
            `cms=http://127.0.0.1:${MOCK_PORT} password=${PASSWORD} sources=${n}`
        );
        return cookie;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error('[e2e] app did not come up in time');
  return null;
}

/**
 * Warm the routes a browser test is about to use.
 *
 * `next dev` compiles on demand, so the first page load of /search and /play can
 * take many seconds. Paying that cost here — before any assertion starts — keeps
 * cold-start latency out of the measured behaviour. Best effort: a route that
 * fails to warm up is simply compiled later instead.
 */
async function warmup(cookie) {
  const paths = ['/login', '/', '/search?q=warmup', '/play?title=warmup&year=2024'];
  const started = Date.now();
  for (const p of paths) {
    try {
      await fetch(`${appUrl}${p}`, { headers: { cookie } });
    } catch {
      /* ignore */
    }
  }
  console.log(
    `[e2e] warmed ${paths.length} routes in ${Date.now() - started}ms`
  );
}

startNext().then(() => ready()).then((cookie) => {
  if (cookie) warmup(cookie);
});
