# e2e / perf harness

Local end-to-end harness: a mock Apple CMS V10 server with real HLS fixtures,
plus a boot script that swaps in a mock-only `config.json` and serves the app
against it — `next build` + `next start` by default, `next dev` under
`E2E_MODE=dev`. Everything the harness touches is restored on exit.

Nothing here talks to the internet — the mock serves the API and the media.

## Files

| File                 | Purpose                                                                                                                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mock-cms.mjs`       | Mock CMS V10 (`/cms/<key>/provide/vod`) + HLS origin (`/media/<quality>/…`), with per-site latency and bandwidth knobs. Also records the search fan-out (`/__hits`) so tests can assert which sources were actually queried.                                                                                                     |
| `serve.mjs`          | Boot harness: swaps `config.json` + `public/sw.js` + `public/workbox-*.js`, regenerates `src/lib/runtime.ts`, starts the mock + the app, restores everything on exit.                                                                                                                                                            |
| `make-media.sh`      | Regenerates the 720p/1080p HLS fixtures (needs `ffmpeg`). Media is gitignored.                                                                                                                                                                                                                                                   |
| `measure.py`         | Play-page time-to-first-frame probe (`clicked` / `cold` / `prefer`). Needs Playwright.                                                                                                                                                                                                                                           |
| `test_play_perf.py`  | **Not in this tree** — lands with the `fix/play-page-first-frame` branch; see [Play-page suite](#play-page-suite). Playwright/pytest suite for the play page's critical path: TTFF budgets, `/api/detail` on the critical path, background search, no blocking spinner, single `<video>`, the advisory banner, plus regressions. |
| `test_av_filter.mjs` | API e2e for the global AV-source filter. Node only, no dependencies.                                                                                                                                                                                                                                                             |
| `test_av_filter.py`  | Browser e2e for the same feature. Needs Playwright.                                                                                                                                                                                                                                                                              |
| `run-av-filter.sh`   | One-command wrapper: boots the harness with the right profile, runs both AV suites, tears down.                                                                                                                                                                                                                                  |

## Source profiles

`serve.mjs` writes one of two `api_site` tables into `config.json`:

| Profile          | Sources                                                                                     | Used by              |
| ---------------- | ------------------------------------------------------------------------------------------- | -------------------- |
| `perf` (default) | `fast`, `mid`, `slow1`, `slow2`, `dead` — all named `E2E-*`, latencies 60 ms → 4 s          | `measure.py`         |
| `avfilter`       | `avfirst` (`AV-e2e-first`), `avflag` (`e2e-flagged`, adult **by flag only**), `fast`, `mid` | the AV filter suites |

Two details make the `avfilter` profile useful:

- the adult source is **first** in the table, because search suggestions only
  ever query the first available source — so "did the filter stop the adult
  source from being queried?" is observable;
- `avflag` has no `AV-` prefix and is adult only via `is_adult: true`, so the
  config-flag path is exercised separately from the name-prefix path.

## AV source filter tests

```bash
./tests/e2e/run-av-filter.sh              # production build (default)
E2E_MODE=dev ./tests/e2e/run-av-filter.sh # next dev, faster but flakier
./tests/e2e/run-av-filter.sh --api-only   # skip the browser suite
```

That builds the app (`next build` + `next start`), boots `--profile=avfilter`,
waits for the app, warms the routes the browser suite will use, runs the API
suite then the browser suite, and restores `config.json` / `src/lib/runtime.ts` /
`public/sw.js` / `public/workbox-*.js`.

Ports: defaults are app `4020`, mock CMS `4010`. Override with `E2E_PORT` /
`MOCK_PORT` if you already have a `next dev` on 4020 — `serve.mjs` refuses to
start on an occupied port rather than let two harnesses fight over `config.json`.

To run the suites by hand:

```bash
node tests/e2e/serve.mjs --build --profile=avfilter  # shell 1
node tests/e2e/test_av_filter.mjs                    # shell 2
python tests/e2e/test_av_filter.py                   # shell 2, needs playwright
```

### Playwright setup

```bash
uv venv .e2e-venv
uv pip install --python .e2e-venv/bin/python playwright
.e2e-venv/bin/python -m playwright install chromium
PYTHON=.e2e-venv/bin/python ./tests/e2e/run-av-filter.sh
```

The runner skips the browser suite (and says so) if `$PYTHON` cannot import
`playwright`. `--api-only` skips it unconditionally.

### What the API suite checks

Against a real server, using the mock CMS's `/__hits` log to prove the adult
sources are never _queried_ (not merely that their results are dropped):

- `/api/search` — no adult `source_name` in the payload; `is_adult`-only source
  filtered too; adult sources absent from the fan-out; `filterAdult=0` restores them
- `/api/search` with `sources=<adult key>` — the request-level filter wins over
  the caller's selection (a stale `savedSources` list cannot smuggle them back)
- `/api/search/one` — an adult `resourceId` 404s while filtering
- `/api/detail` — an adult `source` is an invalid source while filtering
- `/api/search/suggestions` — the adult first source is skipped
- `/api/config/sources` — stays preference-independent (the client trims it, so
  one cached response serves both settings)

### What the browser suite checks

- the 过滤 AV 资源 toggle: present, on by default, not written to localStorage
  until touched, persisted on toggle, restored by 重置
- `/search`: adult sources appear as cards when the toggle is off and none when
  on — asserted on the rendered card hrefs _and_ on the `/api/search` payloads
- the source-selector popup: lists adult sources when off, none when on
- the play page source panel: same, plus the page's own `/api/search` fan-out
- `savedSources`: an adult key is honoured while the toggle is off, stays in
  localStorage while it is on (so toggling back off restores it), and an explicit
  `?sources=` link is not clobbered by the saved-source cleanup

The browser suite forces non-streaming, non-aggregate search
(`defaultStreamSearch=false`, `defaultAggregateSearch=false`) so results come
back as plain JSON and one card per source; otherwise the aggregate view would
hide every source but one behind a single grouped card.

### Why the runner defaults to a production build

`E2E_MODE=build` (the default) runs `next build` and then `next start`. `next dev`
is _not_ reliable enough for a browser suite that drives the app for several
minutes: on-demand compilation means the first `/play` and `/search` cost many
seconds, long-lived dev sessions intermittently returned empty search payloads,
and the HLS proxy path wedges the process at 100% CPU. With a production build
the route warm-up takes ~250 ms instead of ~15 s and the suite is stable.

Use `E2E_MODE=dev` when iterating on a single assertion and you do not mind the
flakiness.

### Known quirks worked around

- **Media requests are aborted** by the browser suite (`MEDIA_GLOBS`).
  `next dev` wedges once the play page pulls HLS playlists/segments through
  `/api/m3u8`. Playback is not what these tests assert, and the resulting
  console noise (hls.js `manifestLoadError`, browser `Failed to load resource`)
  is filtered out via `EXPECTED_CONSOLE_NOISE`.
- **`.next-e2e/` build dir.** The harness sets `NEXT_DIST_DIR` (see `distDir` in
  `next.config.js`). Without it a harness run and your own `next dev` share one
  `.next` and overwrite each other's on-demand-compile manifests, which shows up
  as random `ENOENT … page_client-reference-manifest.js` / HTTP 500 on unrelated
  routes. The directory is **kept** between runs so `next build` can reuse
  `NEXT_DIST_DIR/cache`; pass `--clean` to `serve.mjs` to have it discarded on
  exit instead. Correctness does not depend on this — `--build` always rebuilds
  before serving.
- **`tsconfig.json` excludes `tests/e2e/media`.** The generated HLS segments are
  named `*.ts`; without the exclude both `pnpm typecheck` and `next build` try
  to compile them as TypeScript and fail with hundreds of `Invalid character`
  errors.
- **`public/` build artifacts are snapshotted and restored.** next-pwa rewrites
  `public/sw.js` on every `next build` and emits the workbox runtime beside it
  under a content-hashed name (`public/workbox-<hash>.js`). The hash changes
  whenever a dependency bumps, so a plain build would delete the committed
  `workbox-<hash>.js`, write a differently-named one, and leave `public/` dirty.
  The harness therefore snapshots `sw.js` **and** every `public/workbox-*.js`,
  then restores the snapshot and deletes any bundle the build invented — so
  `git status` is clean after a run either way. The set is the `SWAPPED` list
  plus a `workbox-*.js` glob in `serve.mjs`.

## Perf runs

```bash
node tests/e2e/serve.mjs                 # perf profile, next dev
python tests/e2e/measure.py --scenario clicked
python tests/e2e/measure.py --scenario cold
python tests/e2e/measure.py --scenario prefer
```

Screenshots land in `shots/` (gitignored).

### Play-page suite

> `test_play_perf.py` is **not in this tree yet** — it lands with the
> `fix/play-page-first-frame` branch. Until then use `measure.py` above, which
> covers the same first-frame timing. The suite asserts:

```bash
node tests/e2e/serve.mjs
python -m pytest tests/e2e/test_play_perf.py -v

# against a production build instead of next dev
node tests/e2e/serve.mjs --build
E2E_URL=http://127.0.0.1:4020 python -m pytest tests/e2e/test_play_perf.py -v
```

Why the budgets are meaningful: in the `perf` profile `slow2` answers 4 s after
the request, so anything that waits for the whole fan-out blows straight past
them. The suite asserts

- first frame under budget for all three entry paths (`clicked`, `cold`, `prefer`);
- `/api/detail` is requested for the clicked source, and the multi-source search
  still runs afterwards (the side panel depends on it);
- the page shell (title + episode grid) is on screen _while_ the video loads, and
  the blocking `role=status` skeleton is gone once playback starts;
- exactly one `<video>` exists, even after measurement has run;
- the advisory banner appears for a better source, is dismissible, and does
  **not** silently switch the source;
- background measurement can never replace the page with the error screen — a
  regression test for a bug where the auto-switch resolved its target from the
  empty `availableSources` closure and blew up ~4 s into playback.

Note that the perf numbers are dev-server numbers unless you pass `--build`;
`next dev` pays lazy route compilation on the first hit, which the suite
absorbs with a module-scoped warm-up navigation.

## Cleanup

`config.json`, `src/lib/runtime.ts`, `public/sw.js` and `public/workbox-*.js` are
restored on `SIGINT`/`SIGTERM`/`exit`, and a watchdog exits the harness if its
parent dies so a `SIGKILL` cannot leave a port-squatting `next dev` behind. If
`.e2e-backup/` exists at startup the runner refuses to boot — inspect it and
remove it by hand, since it holds your real `config.json`.

```bash
bash tests/e2e/make-media.sh              # regenerate HLS fixtures (requires ffmpeg)
node tests/e2e/serve.mjs --build --clean   # build, serve, then drop .next-e2e/
rm -rf .e2e-backup                         # only if you are sure nothing is running
```
