# e2e / perf harness

Local end-to-end harness: a mock Apple CMS V10 server with real HLS fixtures,
plus a boot script that swaps in a mock-only `config.json` and serves the app
against it — `next build` + `next start` by default, `next dev` under
`E2E_MODE=dev`. Everything the harness touches is restored on exit.

The test data never comes from the internet — the mock serves the API and the
media. The app itself still makes a few outbound requests of its own (the
version check on `raw.githubusercontent.com`, Douban/Bangumi on the home page);
the suites are written so those failing offline or behind a TLS-intercepting
proxy does not fail a test (see _Console errors_ below).

## Files

| File                      | Purpose                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mock-cms.mjs`            | Mock CMS V10 (`/cms/<key>/provide/vod`) + HLS origin (`/media/<quality>/…`), with per-site latency and bandwidth knobs. Also records the search fan-out (`/__hits`) so tests can assert which sources were actually queried. `fast` serves a messy real-world synopsis and a Douban id, `mid` a short synopsis (see _Play details suite_). |
| `serve.mjs`               | Boot harness: swaps `config.json` + `public/sw.js` + `public/workbox-*.js`, regenerates `src/lib/runtime.ts`, starts the mock + the app, restores everything on exit.                                                                                                                                                                      |
| `make-media.sh`           | Regenerates the 720p/1080p HLS fixtures (needs `ffmpeg`). `CODEC=vp9` for browsers without H.264 (see below). Media is gitignored.                                                                                                                                                                                                         |
| `measure.py`              | Play-page time-to-first-frame probe (`clicked` / `cold` / `prefer`). Needs Playwright.                                                                                                                                                                                                                                                     |
| `test_play_perf.py`       | Playwright/pytest suite for the play page's critical path: TTFF budgets, `/api/detail` on the critical path, background search, no blocking spinner, single `<video>`, the advisory banner, plus regressions. Needs Playwright + pytest.                                                                                                   |
| `test_failover.py`        | Playwright/pytest suite for automatic failover: dead sources are injected with request routing; covers the switch, pick order, no retries, speed tests off, all-failed, banner.                                                                                                                                                            |
| `test_play_details.py`    | Browser e2e for the play page details block: description cleaning, 4-line clamp with 展开全文 / 收起, clearance from the bottom nav, and the 豆瓣 rating button. Needs Playwright and the HLS fixtures.                                                                                                                                    |
| `test_av_filter.mjs`      | API e2e for the global AV-source filter. Node only, no dependencies.                                                                                                                                                                                                                                                                       |
| `test_av_filter.py`       | Browser e2e for the same feature. Needs Playwright.                                                                                                                                                                                                                                                                                        |
| `run-av-filter.sh`        | One-command wrapper: boots the harness with the right profile, runs both AV suites, tears down.                                                                                                                                                                                                                                            |
| File                      | Purpose                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------                               |
| `mock-cms.mjs`            | Mock CMS V10 (`/cms/<key>/provide/vod`) + HLS origin (`/media/<quality>/…`), with per-site latency and bandwidth knobs. Also records the search fan-out (`/__hits`) so tests can assert which sources were actually queried.                                                                                                               |
| `serve.mjs`               | Boot harness: swaps `config.json` + `public/sw.js` + `public/workbox-*.js`, regenerates `src/lib/runtime.ts`, starts the mock + the app, restores everything on exit.                                                                                                                                                                      |
| `make-media.sh`           | Regenerates the 720p/1080p HLS fixtures (needs `ffmpeg`). `CODEC=vp9` for browsers without H.264 (see below). Media is gitignored.                                                                                                                                                                                                         |
| `measure.py`              | Play-page time-to-first-frame probe (`clicked` / `cold` / `prefer`). Needs Playwright.                                                                                                                                                                                                                                                     |
| `test_play_perf.py`       | Playwright/pytest suite for the play page's critical path: TTFF budgets, `/api/detail` on the critical path, background search, no blocking spinner, single `<video>`, the advisory banner, plus regressions. Needs Playwright + pytest.                                                                                                   |
| `test_failover.py`        | Playwright/pytest suite for automatic failover: dead sources are injected with request routing; covers the switch, pick order, no retries, speed tests off, all-failed, banner.                                                                                                                                                            |
| `test_player_controls.py` | Playwright/pytest suite (58 tests) for the player controls on eight viewports (phones portrait/landscape, tablets, laptop, desktop): 10 s seek buttons and their placement, YouTube-style double-tap seeking, the two-level settings menu, and the player fitting on screen. Saves screenshots per viewport.                               |
| `test_av_filter.mjs`      | API e2e for the global AV-source filter. Node only, no dependencies.                                                                                                                                                                                                                                                                       |
| `test_av_filter.py`       | Browser e2e for the same feature. Needs Playwright.                                                                                                                                                                                                                                                                                        |
| `run-av-filter.sh`        | One-command wrapper: boots the harness with the right profile, runs both AV suites, tears down.                                                                                                                                                                                                                                            |

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

If Playwright cannot find its own browser build (for example an image that
ships a preinstalled Chromium of a different revision), point every browser
suite and `measure.py` at it instead of downloading one:

```bash
E2E_CHROMIUM=/opt/pw-browsers/chromium python -m pytest tests/e2e/test_failover.py -v
```

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

- **Media requests are aborted** by the AV browser suite (`MEDIA_GLOBS`).
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
- **Chromium without H.264.** Open-source Chromium builds (some Playwright/CI
  images among them) ship without proprietary codecs: `canPlayType('video/mp4;
codecs="avc1.42E01E"')` returns `''`, MSE rejects `avc1`, and no first frame
  ever renders, so every TTFF test times out. Regenerate the fixtures as VP9 +
  Opus in fMP4 with `CODEC=vp9 bash tests/e2e/make-media.sh`; the playlist
  names are unchanged, so nothing else needs to know.
- **`public/` build artifacts are snapshotted and restored.** next-pwa rewrites
  `public/sw.js` on every `next build` and emits the workbox runtime beside it
  under a content-hashed name (`public/workbox-<hash>.js`). The hash changes
  whenever a dependency bumps, so a plain build would delete the committed
  `workbox-<hash>.js`, write a differently-named one, and leave `public/` dirty.
  The harness therefore snapshots `sw.js` **and** every `public/workbox-*.js`,
  then restores the snapshot and deletes any bundle the build invented — so
  `git status` is clean after a run either way. That set is the `SWAPPED` list
  plus a `workbox-*.js` glob in `serve.mjs`.
- **`tsconfig.json` excludes `tests/e2e/media`.** The generated HLS segments are
  named `*.ts`; without the exclude both `pnpm typecheck` and `next build` try
  to compile them as TypeScript and fail with hundreds of `Invalid character`
  errors.

## Perf runs

```bash
node tests/e2e/serve.mjs                 # perf profile, next dev
python tests/e2e/measure.py --scenario clicked
python tests/e2e/measure.py --scenario cold
python tests/e2e/measure.py --scenario prefer
```

Screenshots land in `shots/` (gitignored).

### Play-page suite

> **Chromium must be able to decode H.264.** The suite asserts on a real first
> frame, so it needs a browser with proprietary codecs — see the
> [Chromium without H.264](#known-quirks-worked-around) note below before
> running it on a CI image. The suite asserts:

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
  **not** silently switch the source; its copy says _sharper_ (更清晰) for a
  resolution upgrade and _faster_ (更快) only for a speed lead;
- the banner is cleared by an episode switch (it was measured for the old one);
- the seeded metrics are really what the banner reads — `LADDER` must match the
  mock's origin (`MOCK_PORT`, default 4010) or the seed silently does nothing;
- background measurement can never replace the page with the error screen — a
  regression test for a bug where the auto-switch resolved its target from the
  empty `availableSources` closure and blew up ~4 s into playback;
- a stored play record pointing past the last episode resumes clamped instead
  of showing the invalid-episode error screen;
- the source panel says it is still searching (with skeleton rows) while slow
  sources are pending, instead of "no sources available";
- the search-card hover prefetch requests exactly the `/api/detail` URL the
  play page then requests (including `filterAdult`), so the warmed cache entry
  is the one the click reads;
- an episode switch keeps exactly one `<video>` and it actually plays (its
  `currentTime` advances).

### Failover suite

```bash
node tests/e2e/serve.mjs --build
python -m pytest tests/e2e/test_failover.py -v
```

Runs on the `perf` profile with no harness changes: each test aborts the mock
CMS's `/media/720p/` (or all of its `/media/`) with Playwright request routing,
so the breakage is per browser context and the other suites never see it. The
patterns are scoped to the mock origin; a bare `**/media/**` would also abort
Next's `/_next/static/media/` fonts. With
720p blocked, `fast`, `dead` and `slow1` fail for the player _and_ the speed
test — what a dead upstream looks like — leaving `mid` and `slow2` (1080p).

The page rewrites `?source=` with `history.replaceState` on load and on every
switch, so an init script wraps `replaceState` and records the exact sequence
of sources tried (`window.__sources`). Text that flashes by too quickly to
poll — the "switching to the next source" status disappears as soon as a
tested source exists — is recorded by a `MutationObserver` (`window.__seen`).
The suite asserts

- landing on a dead source ends up playing a working one, with the failover
  status shown first and a "switched to X" notice after;
- with speed tests on, exactly one switch, straight to a tested source:
  `dead` arrives first in list order but measures broken, so it is skipped;
- after the switch the panel is sorted by health (tested → untested → test
  failed → failed in the player), with `fast` last and tagged 无法播放;
- a source that failed in the player is never switched back to;
- with `enableOptimization=false` it walks the list but never revisits a source;
- with every source broken it stops after at most five switches, keeps the
  play page (not the error screen) and the manual 换源 button, and says so;
- the "better source" banner never appears during failover;
- failing over on first load (opened from 继续观看) resumes the next source at
  the saved position, and the play record moves to it instead of being lost.

The first seven fail on the commit before failover was added; the last one
failed on `1bb3029`, before the resume fix. This suite does not
check console errors: the aborted media requests are the point of the test.

### Play details suite

```bash
CODEC=vp9 ./tests/e2e/make-media.sh   # once; Playwright's Chromium has no H.264
node tests/e2e/serve.mjs --build      # default `perf` profile
python tests/e2e/test_play_details.py [--shots DIR]
```

A plain script (like `test_av_filter.py`), 38 assertions over phone (390×844,
touch) and desktop (1440×900) layouts. It relies on two `mock-cms.mjs`
fixtures: `fast` serves a two-paragraph synopsis in `<p>` tags, indented and
padded with `&nbsp;` and double-encoded `&amp;nbsp;` (what real CMS sources
send), plus Douban id `1292052`; `mid` serves a one-line synopsis and no
Douban id. It checks

- **format** — no entities or tags reach the page, the padding is gone and the
  paragraph break survives as a single line break (server-side `cleanHtmlTags`);
- **clamp** — the long text is clamped to exactly 4 lines with a collapsed
  展开全文 toggle, on both layouts; the short one gets no toggle;
- **nav** — scrolled to the bottom on a phone, the toggle sits above the fixed
  bottom nav and is the element that receives a tap at its centre;
- **toggle** — 展开全文 shows the whole text, 收起 clamps it again and, when
  the paragraph's top had scrolled off-screen, scrolls it back (run at a
  390×480 viewport, since on a full-size phone the expanded fixture fits);
- **rating** — the 豆瓣 button reads `豆瓣 7.5` with an accessible name of
  `豆瓣 评分 7.5`; with no rating, and with the real route while Douban is
  unreachable (it answers `200 { rate: null }`), it stays a plain `豆瓣`;
- **api** — `/api/douban/subject` answers 400 for a bad id.

Two things differ from the other browser suites:

- **Media is served, not aborted.** Aborting it trips the player's automatic
  failover, which swaps the page to another source (and that source's
  description) mid-test; the suite also asserts it is still on `fast` at the
  end. Hence the VP9 fixtures.
- **It scrolls `<body>`, not the window.** `html, body { height: 100%;
overflow-x: hidden }` in `globals.css` makes `overflow-y` compute to `auto`,
  so `<body>` is the scroll container and `window.scrollTo()` is a no-op.

The rating is mocked with `page.route` because the harness cannot reach
Douban; the server route's parsing is covered by
`src/lib/__tests__/douban-rating.test.ts`, and the description cleaner by
`src/lib/__tests__/clean-html.test.ts`.

### Player controls suite

```bash
node tests/e2e/serve.mjs --build
python -m pytest tests/e2e/test_player_controls.py -v
```

Runs on the `perf` profile against `fast`. The fixtures are only 12 s long, so
every seek assertion first pauses the video and places `currentTime` itself
(`_park`): the result is then independent of playback speed, and the player
never reaches `ended`, which would auto-advance to the next episode mid-test.
Touch contexts use `has_touch` (plus `is_mobile` below 1024 px), and taps go
through `page.touchscreen.tap` / `locator.tap()`, so the player sees real
`pointerType: 'touch'` events and the browser's follow-up compatibility
click. `has_touch` alone makes Chromium report `(hover: none)` and
`(pointer: coarse)`, which is what the player's centred touch layout keys on,
so the 1180 px landscape tablet gets it too. Viewports straddle the player's
compact breakpoint (768 px) and the play page's desktop layout (1024 px); the
landscape phones (667 × 375 below `md`, 844 × 390 above it) also hit the
`mobile-landscape` screen, where the player is height-capped (`.o-player-frame`
in `globals.css`).
The suite asserts

- the player has 后退 10 秒 / 快进 10 秒 buttons (order back → play → forward,
  at least 36 px) and no 上一集 / 下一集 buttons; each press moves 10 s,
  clamped at 0 and at the end, and changes neither the episode nor the
  paused state;
- on touch viewports the three buttons are centred over the video,
  symmetric and at least 60 px; with a mouse they stay at the left of the
  bottom bar;
- once the controls auto-hide, the centre buttons stop taking pointer
  events: a tap where the play button was only brings the controls back, and
  a tap where the hidden settings button was does not open the menu (the
  synthesised click used to "tap through" to the control the tap revealed);
- on every touch viewport a double tap on the right / left third seeks
  +10 / −10 s and shows the ripple on that side, without toggling playback;
  the same works while playing with the controls hidden;
- a third tap on the same side within the chain window adds another 10 s
  and the ripple shows the total (20 秒); after the window a single tap does
  not seek;
- a double tap in the middle third still toggles play / pause, with no seek;
  a single tap only shows / hides the controls;
- with a mouse, click still toggles playback and double-click still goes
  fullscreen, without seeking;
- Alt + ← / → still switches episodes and ← / → still seeks 10 s;
- the settings menu: level 1 is exactly 去广告 / 弹幕 / 片头片尾 › / 弹幕设置 ›,
  switches flip in place, each category opens a level-2 page with a
  "返回 · <category>" header, the summaries follow the state (关 → 开), the
  弹幕 switch and 显示弹幕 stay in sync, and reopening starts at level 1;
- the menu lies entirely inside the player and every row can be scrolled
  into view inside it; on portrait phones the level-2 page is taller than
  the space and scrolls within the menu without scrolling the page; the
  centre buttons step aside while it is open;
- the whole player plus the bars pinned over the page (the sticky top nav
  from 768 px up, the fixed bottom tab bar below it) fits the screen on every
  viewport, so the bottom bar is reachable (on landscape phones it used to be
  pushed below the fold or under the nav).

Against the code before this change 43 of the 58 fail; the other 15 are the
guards for unchanged behaviour plus the fit check on the six viewports that
already fit.

Screenshots: `shots/player-controls-<viewport>-{bar,settings,settings-skip,ripple-forward,ripple-back,ripple-chain,hidden}.png`.

### Console errors

Both browser suites fail on unexpected console errors, with two deliberate
exemptions:

- **External origins.** `test_play_perf.py` only counts errors located on the
  app or mock origin. Chromium attributes a "Failed to load resource" message
  to the failed resource's URL, so the app's own internet requests failing
  offline do not count, while a failed `/api/...` request still does.
- **Requests cancelled by a navigation.** Navigating while the previous page
  still has fetches in flight cancels them, and the app logs each as
  `TypeError: Failed to fetch`. `test_play_perf.py` avoids it by doing its
  storage setup on `/login` instead of detouring through the home page;
  `test_av_filter.py` drives one page through several phases, so it ignores a
  "Failed to fetch" logged within 1.5 s of a navigation starting
  (`NAVIGATION_ABORT_WINDOW_S`). It also opens the settings menu from `/search`
  rather than the home page, which this suite does not test.

Measured with `--build` on the same mock (first frame, ms):

| entry path                    | before (`main`) | after |
| ----------------------------- | --------------- | ----- |
| clicked a search result       | 855             | ~400  |
| clicked a Douban card (cold)  | 4558            | ~400  |
| auto-pick-best-source enabled | 4737            | ~500  |

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
