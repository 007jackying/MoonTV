# Dev log

Running log of checkpoints, checks, reviews and decisions. Newest first.
Each entry says what was checked, what was decided and why, and what is still
open, so a later change can tell whether a decision still holds.

---

## 2026-10-12 — Player: 10 s seek, double-tap, centred touch controls, two-level settings (3.13.0)

Branch: `ccr-cd92788a-sb26eu`. Requested from production screenshots: the
buttons beside play should skip 10 s rather than change episode; on mobile,
double-tap left / right to seek like YouTube; put the three buttons in the
centre on phones and tablets; the settings popover could not be scrolled on a
portrait phone, so split it into an essentials level and categories.

### What changed

- **Seek buttons.** The 上一集 / 下一集 buttons in the player are now 后退 / 快进
  10 秒 (`SEEK_STEP`, `seekBy`), drawn as ⟲10 / ⟳10 (`SeekIcon`). Episode
  navigation stays on the episode grid, the 下一集 card, Alt + ← / → and
  auto-advance; `hasPrev` / `hasNext` / `onPrev` / `onNext` remain props only
  for those shortcuts. The unused `nextLabel` prop and its i18n keys went.
- **Double tap (touch).** `handleSurfacePointerUp` splits the surface into
  thirds: double tap left / right calls `tapSeek(∓1)`, middle still toggles
  play. Within `SEEK_CHAIN_MS` (700 ms) of a seek, each further tap on a side
  seeks again and the ripple shows the running total. Keyed on
  `pointerType === 'touch'`, not width.
- **Centred touch layout.** `touchLayout` = `(hover: none) and (pointer:
coarse)`; `renderTransport('center' | 'bar')` renders the three buttons
  either centred over the video (z-25, larger) or at the left of the bar.
  They follow the controls' visibility, step aside while a menu is open
  or the double-tap ripple shows (`centreVisible`), and show the buffering
  spinner inside the play button.
- **Settings menu.** `PlayerSettingItem` gained `kind: 'group'`. Level 1:
  去广告, 弹幕, 片头片尾 › (on / off), 弹幕设置 › (source); level 2 has a
  "返回 · <category>" header. `settingsPage` resets whenever the menu closes.
- **Menu height.** `PopoverMenu` measures the space between its bottom and the
  player's top (`boundsRef`, re-measured by a `ResizeObserver`) and scrolls
  inside that, instead of `max-h-[min(60vh,360px)]`.
- **Player height on landscape phones.** `.o-player-frame` in `globals.css`
  caps the 16:9 frame at one screen minus the pinned nav (68 px bottom tab
  bar + safe area below `md`, 76 px sticky top nav from `md`).

### Bugs found while testing, and decisions

- **Settings menu clipped, not scrollable (reported).** The popover's cap was
  60vh, but the player is `overflow-hidden` and ~220 px tall on a portrait
  phone: the menu was cut by the player and never overflowed itself, so there
  was nothing to scroll. _Decision:_ measure against the player, not the
  viewport; two levels keep level 1 at four rows so it usually fits outright.
- **Tap-through on touch (pre-existing).** A tap is handled on `pointerup`,
  which reveals the controls; the browser's compatibility `click` then hit the
  control that had just appeared. Reproduced on the old build: a tap where the
  hidden settings button sits opened the settings menu. With the centred
  layout it would also have paused the video. _Decision:_ `preventDefault()`
  on the surface's `touchend` cancels that click (taps are fully handled by
  pointer events) and also iOS double-tap zoom on the video.
- **Centre buttons covered the menu.** On a short phone the z-25 centre
  overlay sat over the settings menu (z-20 bar) and stole its taps.
  _Decision:_ hide the centre buttons while any menu is open (YouTube does too).
- **Player taller than the screen in landscape (pre-existing).** At 844 × 390
  the bar was below the fold; a plain `100svh` cap still left the top under
  the sticky nav, and at 667 × 375 the fixed tab bar covered the bottom.
  _Decision:_ the cap subtracts whichever nav is pinned at that width. It is a
  plain CSS class because a Tailwind arbitrary `calc()` would respace the
  hyphens inside `env(safe-area-inset-bottom)`.
- **Ripple under the centre buttons.** With the video paused the controls
  stay up, so on a 360 px phone the 「20 秒」 ripple sat under the centred
  back button. _Decision:_ the centre buttons also step aside while the ripple
  shows (≈0.7 s), as on YouTube.
- **Ripple contrast.** A 12 % paper overlay was unreadable on bright frames;
  now 40 % ink with a text shadow.
- **Version.** User-facing change, so a minor bump. 3.12.0 was taken by #14
  (description folding, Douban rating), which merged while this was in
  progress, so this is 3.13.0; the branch was rebased onto that `main`.
  `VERSION.txt` / `version.ts` bumped by hand as before (the script only does
  it in GitHub Actions).

### Checks run

- `pnpm typecheck` clean; eslint and prettier clean on every changed file.
  The one repo-wide eslint error (`api/admin/data_migration/import/route.ts`)
  and the prettier warnings are pre-existing.
- `pnpm test`: 105 / 105 (with `runtime.ts` generated from the real config).
- `test_player_controls.py`: 58 / 58 on the production build, 8 viewports
  (65 / 65 after the review below).
  Against the code before this change: 43 fail, 15 pass (the guards for
  unchanged behaviour, and the fit check on the six viewports that already
  fit). The tap-through and landscape-fit tests were confirmed red before
  their fixes, then green.
- `test_play_perf.py` 21 / 21 and `test_failover.py` 8 / 8 on the same build.
- Screenshots of every viewport reviewed (`tests/e2e/shots/player-controls-*`).

### Open / not done

- Sandbox shortcuts, not committed (as before): `mux.js` stubbed in
  `node_modules` (codeload.github.com is blocked here), VP9 fixtures.
- Real-device check on iOS Safari and Android Chrome is still worth doing:
  Chromium's touch emulation covers pointer events and the compatibility
  click, but not Safari's gesture heuristics.
- Release tagging `v3.13.0` is left to the maintainer.

### Review follow-up (same release)

Reviewing the first build on a phone-sized touch context turned up four gaps.
Each was reproduced with a probe first, then got a test that failed on that
build (7 new tests, `test_player_controls.py` now 65).

- **Controls popped up after a double-tap seek.** The first tap of a double
  tap goes through the single-tap path and reveals the controls; the centre
  buttons only stepped aside while the ripple showed, so ~0.7 s later they
  and the bar came back over the playing video for the rest of the 2.6 s.
  _Decision:_ `tapSeek` hides the controls (and cancels the hide timer) when
  the video is playing, as YouTube does. Paused, the controls stay up as before.
- **Second tap landed on the revealed centre button.** At 360 / 390 px the
  centre ⟲10 / ⟳10 buttons lie almost entirely inside the left / right
  thirds, so with the controls hidden the second tap of a double tap often
  hit the button the first tap had just revealed: one plain 10 s seek, no
  ripple, no chaining, controls left up. _Decision:_ the centre side buttons
  go through `centreSeek`, which treats a press within `DOUBLE_TAP_MS`
  (300 ms, now a named constant shared with the surface handler) of a
  surface tap as the second half of a double tap (`tapSeek`). Delaying the
  buttons' pointer events was the alternative; it would make a deliberate
  quick press on a just-revealed button do nothing.
- **No way to change episode in fullscreen.** With 上一集 / 下一集 gone from
  the player, fullscreen (where the episode grid and the 下一集 card are out of
  reach, and touch has no Alt + →) only offered auto-advance. _Decision:_ a
  下一集 button in the bar's right group, shown only in fullscreen and only
  when there is a next episode. Outside fullscreen the player still has no
  episode buttons, as requested. No 上一集: going back is rarer and the
  page's grid is one tap away after leaving fullscreen.
- **← / → did nothing near either end.** The old keyboard guard
  (`currentTime > 5`, `< duration - 5`) predates the buttons; the buttons
  clamp, so the keys now call the same `seekBy` and clamp too.
- **Docs.** The e2e README's file table had been duplicated by the rebase
  (and the second copy lacked `test_play_details.py`); merged back into one.
  README.md described the landscape cap as `mobile-landscape:max-h-[100svh]`;
  it is `.o-player-frame` (one screen minus the pinned nav), see above.
- **Test race found on the way.** The new helper that waits for the controls
  to hide passed instantly right after a double-tap seek (still hidden,
  about to fade in after `_park` paused), so the next tap hit a visible
  button about half the time. It now waits for "shown" first, then "hidden";
  60 repeated runs of the touch tests passed afterwards.

Checks after the follow-up (production build): `pnpm typecheck` clean,
eslint / prettier clean on changed files, `pnpm test` 105 / 105,
`test_player_controls.py` 65 / 65, `test_play_perf.py` + `test_failover.py`
29 / 29, `test_play_details.py` 38 / 38, `run-av-filter.sh` API 24 / 24 and
browser 31 / 31.

### Usability pass (same release)

A walk through the whole flow (home → search → result → play → settings →
double tap → episode switch → details → fullscreen) on all eight viewports,
with screenshots of every step, plus a probe of each finding from two code
reviews. Each finding below was reproduced on the previous build first.

- **Double tap low on the video (serious).** The bottom bar covers roughly the
  lower half of a portrait phone's player (timeline, button row, and a
  gradient above them). With the controls hidden, the first tap revealed the
  bar and the second landed on it: the timeline jumped to the finger
  (+8.8 s instead of +10), the settings button opened the menu, or the
  gradient swallowed the tap. _Decision:_ fix the cause rather than each
  control. Controls revealed by a tap ignore taps for `DOUBLE_TAP_MS`
  (`tapGuard`), and also while the ripple shows, so chained taps reach the
  video even while paused. The bar's gradient never takes taps; only the
  timeline and button row do. This replaces `centreSeek` from the first
  follow-up, which only covered the two centre seek buttons. 300 ms is
  shorter than anyone needs to see a control and then aim at it, and a test
  checks that revealed buttons work after it.
- **Middle double tap while paused.** The centre play button covers the
  middle, so both taps hit it: play, then pause at once. _Decision:_ the
  centre play button ignores a second press within `DOUBLE_TAP_MS`, so a
  middle double tap toggles once wherever it lands.
- **Ripple overstated near the ends.** At 0:03 four taps back showed
  「30 秒」 for a 3 s move. _Decision:_ the ripple adds up the distance
  actually moved (`tapSeek` measures it after the clamped seek).
- **Landscape height cap still wrong.** At 667 × 375 the mobile title bar
  (56 px, not sticky) sits above the player, so the whole control bar ended
  under the fixed tab bar. At 844 × 390 the page's `md:pt-2` pushed the
  player 8 px off-screen. The fit test passed both because it added up
  heights. _Decision:_ `.o-player-frame` also subtracts the title bar below
  `md` and the 8 px from `md` up. The test now checks positions at scroll 0
  (on screen, nothing pinned overlapping).
- **Settings menu.** Keyboard focus fell to `<body>` when a row unmounted on
  a page change, and Space then toggled playback. Level 2 kept level 1's
  scroll position, which could hide the back row. The first measurement ran
  mid pop-in animation (`translateY(4px)`), so the menu sat 4 px from the
  player's top instead of 8. _Decision:_ `PopoverMenu` takes a `pageKey`: on
  change it scrolls to the top and focuses the new page's back row, or the
  row you came from on return. It re-measures on `animationend`. The back
  row is now `role="menuitem"` like the other rows.
- **Seek labels** are functions of `SEEK_STEP` (`t.seekBackward(n)`), so the
  aria-label and tooltip cannot drift from the step.

Considered and kept as is:

- **→ / ⟳10 / double tap near the end** go to the end, the video ends and
  auto-advances. This matches YouTube and Netflix, and it is the same for
  the buttons, the keys and the gesture. The old keyboard-only guard
  (nothing within 5 s of the end) was the inconsistent one.
- **弹幕 switch at both levels.** It is a quick toggle on level 1 and the
  same switch inside 弹幕设置 next to the source. This is a common pattern,
  and both stay in sync (tested).

Tests: 15 new (13 fail on the build before this pass; 2 check that revealed
buttons work after the window), and 3 updated (position-based fit, honest
ripple totals), for 80 in `test_player_controls.py`. The 32 touch tests
passed 5 repeated runs in a row.

Checks (production build): `pnpm typecheck` clean, eslint / prettier clean
on changed files, `pnpm test` 105 / 105, `test_player_controls.py` 80 / 80,
`test_play_perf.py` + `test_failover.py` 29 / 29, `test_play_details.py`
38 / 38, `run-av-filter.sh` API 24 / 24 and browser 31 / 31. The full-flow
screenshots ran clean on all eight viewports.

## 2026-10-12 — Play page: collapsible description, entity cleanup, Douban rating (3.12.0)

Branch: `ccr-3a769764-ajviad`. Three reports from a phone: the description ran
off the bottom of the screen with no way to fold it, some sources' synopses
ended in a long run of literal `&nbsp;`, and the 豆瓣 button should show the
rating ("豆瓣 7.5").

### What changed

- **Description** — `ExpandableDescription` in `PlayDetails.tsx`, shared by
  the desktop and mobile layouts: clamped to 4 lines (`line-clamp-4`) with a
  展开全文 / 收起 toggle that only renders when the text overflows (measured
  with a `ResizeObserver`). The expanded state is keyed to the description
  string, so switching title / episode collapses it without an effect. 收起
  scrolls the paragraph back if its top had scrolled off-screen.
- **Cleaning** — `cleanHtmlTags` (`src/lib/utils.ts`) now decodes entities
  first (named incl. `&nbsp;`, decimal, hex; up to three rounds for
  `&amp;nbsp;`; `&nbsp` without a semicolon), then strips tags: block tags
  become a line break, inline tags are dropped (previously every tag became a
  line break, splitting sentences at `<span>`), and whitespace is collapsed
  per line, including NBSP, full-width spaces and zero-width characters.
- **Rating** — `/api/douban/subject?id=` (edge) tries Douban's
  `subject_abstract`, then the mobile `rexxar` API; parsing lives in
  `src/lib/douban-rating.ts`. `getDoubanRating` in `douban.client.ts` follows
  the 豆瓣数据源 setting like every other Douban call (server route for
  `direct`, proxy / CDN otherwise) and memoises per id. `fetchDoubanData`
  gained an optional `referer` (rexxar needs `m.douban.com`).

### Decisions

- **Upstream failure answers `200 { rate: null }` with `no-store`, not 502.**
  The client treats "unreachable" and "unrated" the same (plain 豆瓣), and a
  deployment whose server cannot reach Douban would otherwise log a red 502
  on every play page. This surfaced in e2e: once the mock `fast` source had a
  Douban id, every existing play-page suite hit the route.
- **The rating number uses the body font**, like the source card's speed
  figures; Caprasimo at 13px made "7.5" hard to read.
- **No `rate` passed through the URL** from Douban cards. The fetch is cached
  and fast enough; passing it would add a second source of truth.
- **Left `html, body { height: 100%; overflow-x: hidden }` alone.** It makes
  `<body>` the scroll container (overflow-x forces overflow-y to `auto`), so
  `window.scrollTo()` does nothing. It is app-wide and older than this
  change; content is fully reachable by touch scrolling, so it is documented
  in `tests/e2e/README.md` rather than changed here.

### Checks run

- Jest: 103 passed (8 suites), including new `clean-html.test.ts` (10) and
  `douban-rating.test.ts` (5) and the i18n key-parity test.
- `tsc --noEmit` clean; ESLint `--max-warnings=0` and Prettier clean on every
  changed file.
- e2e on a production build (`serve.mjs --build`, VP9 fixtures):
  `test_play_details.py` 38/38 (new); `test_play_perf.py` + `test_failover.py`
  29/29; `run-av-filter.sh` API 24/24, browser 31/31 — the mock fixture
  changes do not disturb the other suites.

### Found while testing

- The first version of the suite aborted media like the AV suite does; the
  player's failover then swapped the page to `slow2` mid-test. The suite now
  serves real media and asserts it is still on `fast` at the end.
- Douban is unreachable from the CI sandbox, so the rating is mocked with
  `page.route` in the browser and the server parsing is unit-tested; the real
  route is exercised only for its failure path.

### Open / not done

- The CDN data sources (`cmliussss-cdn-*`) are assumed to pass
  `/j/subject_abstract` through like `/j/search_subjects`; not verified from
  here. If they do not, the button simply shows 豆瓣 without a number.
- `mux.js` is a GitHub tarball dependency that the sandbox proxy blocks;
  local verification used the npm `mux.js@7` build. Not part of the diff.

## 2026-10-05 — Automatic failover on the play page (3.11.0)

Branch: `claude/kind-heisenberg-zr8fhr`. Reported from production: opening
起义 on `TV-电影天堂资源` left the page on 该播放源无法播放，请尝试换源, and
the panel listed two sources whose speed test had failed (无测速数据) above
two that measured fine.

### What changed

- **Failover.** `handlePlayerError` (first-load failure, or recovery given up
  mid-playback) records the failure and turns failover on; an effect re-runs
  `pickFailoverSource` whenever measurements, search results or the failed set
  change, and calls `handleSourceChange` as soon as it gets a `switch`.
- **Ranking** lives in `src/components/play/sourceHealth.ts` as pure functions
  (`healthOf`, `scoresOf`, `rankSources`, `pickFailoverSource`) with unit
  tests. Tiers: tested-OK by score → untested → test failed → failed in the
  player; stable within a tier.
- **Panel** sorts by those tiers once any failure has happened
  (`prioritizeHealthy`) and tags player failures with 无法播放 (`FailedTag`,
  now shared by the current-source card and the rows).
- **Speed tests** of every other source start as soon as the current one fails
  (`testAll` includes `playerFailed`), so failover has data without the panel
  being opened.
- **Copy**: `findingNextSource`, `allSourcesFailed`, `autoSwitchedTo` (zh/en);
  the player's failure card takes `errorDetail` / `errorBusy`.

### Decisions

- **Wait for a tested source rather than walk the list.** On the reported page
  the next two rows were broken; trying them in order costs ~3 s each. The
  pick waits while any candidate is unmeasured or the search is still
  streaming. _Bound:_ measurements have their own 4 s / 6 s timeouts, and
  failover stops waiting after `FAILOVER_MAX_WAIT_MS` (8 s) regardless.
- **Speed tests off → list order.** With `enableOptimization=false` there are
  no measurements to wait for.
- **Test-failed sources are a last resort, not excluded.** The probe is a
  lightweight `fetch`; it fails on CORS and timeouts that the player may not
  hit. They are tried only after the search has finished and nothing better
  exists.
- **Termination.** A source that failed in the player is never picked again
  for that episode (failures are keyed `source#episode`, like measurements,
  because another episode of the same source may be on a different upstream),
  and one failure chain makes at most `MAX_AUTO_FAILOVERS` (5) switches. The
  count resets on a successful start, an episode change, or a manual pick.
- **Also on mid-playback failure,** not just first load: the player only
  reports `onError` after it has given up recovering, and `handleSourceChange`
  resumes at the same position on the new source.
- **Sort only after a failure.** Re-sorting a list the user is reading on every
  measurement would make rows jump; before any failure the order is unchanged.
- **Manual pick wins.** Picking a source during failover cancels it and resets
  the count; if that pick fails, failover starts again from it.

### Review of the first commit (`4c202ca`) and what changed after it

- **自动优选 could re-pick a source that just failed in the player** if its
  probe passed. _Fix:_ `preferBestSource` returns the best score that has not
  failed for this episode, or stays on the current source.
- **The "better source" banner could appear for a failing page**, or point at
  a source that already failed. _Fix:_ `suggestBetterSource` bails out while
  the current source is failing, excludes failed sources, and the banner is
  cleared on failure. Both read refs (`playerFailedRef`, `failedSourcesRef`)
  because `suggestBetterSource` runs from the first-render closure; the refs
  are written eagerly in the error handler.
- **Failures were stored one episode per source** (`Map<source, episode>`), so
  a later failure overwrote an earlier one. _Fix:_ a `Set` of
  `source#episode`.
- **Duplicated tag markup.** _Fix:_ one exported `FailedTag`.
- Comments in `useSourceSpeedTest` and `VideoPlayer.onError` updated to say
  failure now triggers testing and failover.

### Checks run

| check                                         | result                                    |
| --------------------------------------------- | ----------------------------------------- |
| `pnpm typecheck`                              | clean                                     |
| `pnpm test` (jest)                            | 79/79 (was 71; 8 new in `sourceHealth`)   |
| eslint + prettier on changed files            | clean                                     |
| `test_failover.py` (production build)         | 7/7, three consecutive runs               |
| `test_failover.py` against `main` (`b7bdf6b`) | 0/7 — every case fails without the change |
| `test_play_perf.py` (production build)        | 21/21                                     |
| `run-av-filter.sh` (production build)         | API 17/17, browser 27/27                  |

Timed in the browser (production build, 720p blocked, 5 runs after a
warm-up): the failure card appears at a median 370 ms after navigation and the
next source is playing at 1245 ms, so failover itself (waiting for `mid` to
measure, switching, loading) takes ~0.9 s. The 370 ms is an artefact of
aborted requests failing instantly; a real dead upstream takes up to the
player's ~3 s first-load budget to be declared failed.

### Test-suite decisions

- **Breakage is injected with Playwright routing,** not a new mock profile:
  aborting `**/media/720p/**` breaks `fast`, `dead` and `slow1` for both the
  player and the probe, which is what a dead upstream looks like, and keeps
  the `perf` profile untouched for the other suites.
- **The failover sequence is read from `history.replaceState`,** which the page
  calls with the new `?source=` on load and on every switch. Media URLs can't
  tell sources apart (sources of one quality share a ladder), so this is the
  only exact record of which sources were tried.
- **Transient text is recorded by a `MutationObserver`.** The "switching"
  status disappears as soon as a tested source exists; polling missed it.
- **`E2E_CHROMIUM`** lets every browser suite and `measure.py` use a
  preinstalled Chromium when the pip Playwright release expects a different
  revision (this sandbox). Unset, Playwright's own browser is used.

### Open / not done

- The mock cannot produce a source that fails the probe but plays, so the
  "test-failed as last resort that then works" path is covered by unit tests
  only.
- Sandbox shortcuts, not committed: the git-hosted `mux.js` dependency is
  blocked here (codeload.github.com 403), so it was stubbed in `node_modules`;
  fixtures were VP9; `public/sw.js` regenerated by the build was restored.
- Release tagging `v3.11.0` is left to the maintainer.

### Review follow-up: keep the saved position when failing over on first load

Found in review: open a title from 继续观看 (play record at 7 s) on a source
that is dead. The player fails before it ever plays, so `getCurrentTime()` is
0; `handleSourceChange` resumed the next source from 0 and deleted the old
play record, so the saved position was gone. Manual switching after a
first-load failure always behaved this way; failover made it automatic.

_Decision:_ remember the position each load started from (`loadStartTimeRef`,
set in `takeResumeTime`), and when switching use the player's time once it is
past 1 s, else that start position. Mid-playback switches are unchanged.
`test_failover_on_first_load_keeps_the_saved_position` failed before the fix
(resumed at 0.21 s) and passes after it.

Also: the failover suite's block patterns are scoped to the mock origin, since
`**/media/**` also aborted Next's `/_next/static/media/` fonts; and merging
`main` folded the unreleased 3.10.1 CHANGELOG section into 3.11.0, because
`VERSION.txt` goes from 3.10.0 straight to 3.11.0.

---

## 2026-10-05 — Husky hooks made executable

`.husky/pre-commit`, `.husky/commit-msg` and `.husky/post-merge` were committed
as mode `100644`. Git only runs executable hooks, so on every clone it printed
"hook was ignored because it's not set as executable" and skipped lint-staged
and commitlint entirely.

_Decision:_ set them to `100755` in the index (`git update-index --chmod=+x`)
so the bit travels with the repository, rather than adding a `chmod` step to
`prepare` that would only fix the machine that ran it.

A fresh clone now gets the hooks as `-rwxr-xr-x`. Checked on a branch cut
from `main`:

- a commit message without a conventional type is rejected by commitlint
  (`type-empty`);
- a staged `.ts` file with a `console.log` is rejected by lint-staged
  (`eslint --max-warnings=0`, `no-console`);
- a conventional commit with clean files goes through.

Worth knowing: `post-merge` runs `pnpm install` after every `git pull` or
merge. That was always the intent of the hook; it simply never ran before.

Found in review (#12): `public/sw.js` and `public/workbox-*.js` are tracked
next-pwa build output that every `next build` rewrites. With the hooks live,
the first `git commit -a` after a local build failed in pre-commit on the
minified worker (`importScripts` / `define` are not defined, `no-undef`).
_Decision:_ move the lint-staged config from `package.json` to
`lint-staged.config.js` and filter those two paths out of eslint and prettier.
`.eslintignore` cannot do it: ESLint 8 reports an explicitly passed ignored
file as a warning, and `--max-warnings=0` fails on that. The config file is
deliberately not a dotfile (`.lintstagedrc.js`): ESLint ignores dotfiles by
default, so editing it would trip the same warning.

Also worth knowing: commitlint's `subject-case` rejects a capitalised subject
(`feat: Organic redesign …`). Of the last 40 non-merge commits on `main`, 6
would now be rejected (2 `subject-case`, 1 unknown type `remove`, 3 with no
type). Commits made in the GitHub web UI do not run hooks.

---

## 2026-10-05 — #11 follow-up: label sources pinned by the config file

Re-review of #11 with a feature e2e against a production build: localstorage
mode, and a database-backed mode (Upstash REST API served by a local shim over
`redis-server`). Every behaviour the #11 docs describe held: pinned sources
ignore the admin toggle, unpinned toggles survive reloads, an existing database
deployment ignores the repo `config.json` until it is pasted into 配置文件,
deleting `disabled` does not re-enable a source while `disabled: false` does,
and a play record on a disabled source falls back to another source.

_Revised:_ the first review rated "启用 on a pinned source silently does
nothing" a nit. In the running admin panel it is a button that returns 200 and
changes nothing, on 41 rows once #11 ships, and 批量启用 does the same.
_Decision:_ sources whose `disabled` is set in the stored `ConfigFile` show
「由配置文件控制」 with a tooltip instead of the toggle, and batch enable/disable
skip them and say how many were skipped (the same pattern batch delete uses for
config sources). No server change: the merge rule is unchanged, and a direct
API call is still overridden on the next read.

Also: prettier on the two files #11 added (`config-disabled.test.ts`,
`docs/broken-sources.md`).

Found while testing, not caused by #11 and not fixed here: `redis` and
`kvrocks` storage cannot work in this fork, because the layout and API routes
run on the edge runtime and the TCP `redis` client needs Node's `url.URL`
(`TypeError: C.URL is not a constructor` on every request). With
`DOCKER_ENV=true`, `config.ts` calls `eval('require')`, which the edge runtime
rejects. Upstash (HTTP) works.

---

## 2026-10-05 — #7 rebuilt on `main` (disable dead sources), docs corrected

#7 (disable 41 dead sources via `disabled` / `note`) targeted `rename/dreamtv`,
which is behind `main`, so merging it would not have shipped anything. Its
three commits were replayed onto `main` (after #9) as #11. Only the generated
`src/lib/changelog.ts` conflicted; it was regenerated from the merged
`CHANGELOG` and run through prettier (the original was regenerated without it:
a 641-line diff for six entries).

The code was correct. The docs promised more than it does; decisions:

- **Where the flags take effect.** In local-storage mode the deployed
  `config.json` is read. In database modes (redis/upstash/kvrocks/d1) the repo
  `config.json` only seeds a fresh install; `getConfig()` reads the config text
  saved in the admin 配置文件 tab. _Decision:_ say so in the README,
  `docs/broken-sources.md` and the code comments, and tell admins to paste the
  new config there. No code change: syncing the repo file into the database on
  boot would silently overwrite admins' edits.
- **Re-enabling.** The merge only overrides stored state when `disabled` is
  present, so deleting `disabled: true` leaves a stored source disabled on
  database deployments. _Decision:_ document "set `disabled: false`, delete the
  field only after every deployment has it" instead of changing the merge rule,
  which deliberately matches `is_adult` and lets admin toggles survive reloads
  for unpinned sources.
- **Probe headers.** The probe sent a short UA while the app sends a full
  Chrome UA. _Decision:_ the documented probe now uses the app's headers and
  takes `ALL=1` to include disabled sources.
- **Changelog placement.** #7 filed its entries under the released 3.9.0;
  _decision:_ move them to the open 3.10.1 section #9 created.
- **Not verified, recorded as open** (the sandbox could not reach these hosts):
  whether the six `HTTP_403` sources pass with the app's UA, and whether the six
  `SEARCH_DISABLED` sources still answer detail requests — if they do,
  excluding them from search only would keep users' saved items playable.

Process note: #8 was closed and re-landed as #9 while this review was running;
a duplicate replay (#10) was opened against a stale `main` and closed. Check
the base branch's current head before opening a replay.

---

## 2026-10-05 — Review of #6: play page first frame (3.10.0)

PR: <https://github.com/007jackying/MoonTV/pull/6> (`fix/play-page-first-frame`).
Scope: the `perf(play)` commit plus the DreamTV rename and AV source filter
commits it carries.

### Checks run

| check                                  | result                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm typecheck`                       | clean                                                                              |
| `pnpm test` (jest)                     | 71/71 (was 62)                                                                     |
| `pnpm lint`                            | only the pre-existing `no-constant-condition` in `api/admin/data_migration/import` |
| `next build`                           | compiles                                                                           |
| `test_play_perf.py` (production build) | 21/21, three consecutive runs                                                      |
| `run-av-filter.sh` (production build)  | API 17/17, browser 27/27                                                           |
| `measure.py` vs `main`, same mock      | see table below                                                                    |

First frame, production build, identical mock latencies (ms):

| entry path                    | `main` | this PR |
| ----------------------------- | ------ | ------- |
| clicked a search result       | 855    | ~400    |
| clicked a Douban card (cold)  | 4558   | ~400    |
| auto-pick-best-source enabled | 4737   | ~500    |

The PR description's "before" numbers (2045 / 5027 / 5346) were taken under
`next dev`, which includes on-demand compilation; the clicked-path figure in
particular overstates the gain. README and CHANGELOG now quote the
production-build numbers.

### Review findings and decisions

Ten review threads, all confirmed against the running app or a failing test
before fixing:

1. **Resume index could exceed the episode list** and swap the player for the
   error screen, now that detail can arrive before the play record.
   _Decision:_ clamp in the history effect when detail is known; otherwise
   write the index as-is and let `initDetail` clamp. **Rejected** the review's
   suggested snippet: when the record loads first (the usual case with
   localStorage) it treats the unknown episode count as 0 and resets every
   resume to episode 1. Both refs (`detailRef`, `currentEpisodeIndexRef`) are
   written eagerly so the clamp holds whichever side commits first. A clamped
   resume does not restore `play_time` — it belongs to another episode.
2. **Card prefetch missed `filterAdult`**, so it warmed a cache key the play
   page never reads. _Decision:_ go through `withAdultFilterParam`, like
   `SearchSuggestions`.
3. **Measurements were keyed by source only** and never re-ran after an episode
   switch. _Decision:_ key results by `source#episode` inside the hook but keep
   the returned `infoMap` keyed by source (filtered to the current episode), so
   `PlayPanels` is unchanged. Auto-pick's precomputed results carry the episode
   they were measured for.
4. **Timeout covered headers only**; a source that stalled after headers hung
   the measurement queue and the auto-pick spinner. _Decision:_ one budget for
   headers and body (`fetchTextWithTimeout`); same fix in `fetchDirectDetail`.
5. **Docs claimed a legacy hls.js fallback** that no longer exists.
   _Decision:_ remove the dead `fallback` option and document the real
   behaviour (no CORS → `hasError`, not ranked).
6. **`parseMasterQuality` doc contradicted the code.** _Decision:_ the code
   (max width, bandwidth breaks ties) is intended — the tests say so — so fix
   the doc.
7. **No in-flight dedupe** across auto-pick, the advisory and the panel.
   _Decision:_ module-scoped `Map<url, Promise>`, entry removed on settle so a
   failure can be retried. Browser check: the 1080p manifest went from 2
   fetches to 1.
8. **Advisory banner outlived its premise.** _Decision:_ clear it on episode or
   source change, and drop a suggestion whose measurement finished after the
   user switched.
9. **`episodeUrlOf` duplicated.** _Decision:_ export from
   `useSourceSpeedTest` and import.
10. **"Measuring" indicator appeared after the work.** _Decision:_ in-flight
    keys are React state, not a ref.

Found while testing in a real browser:

- **Banner had no background**: `bg-o-video-ink/88` is not on Tailwind's
  opacity scale, so no class was generated and white text sat on light video
  frames. _Decision:_ `/85`, an existing step used elsewhere.
- **Panel said "no sources available" mid-search**: the loading flag was
  cleared on the first streamed batch, which on a cold start is the source
  already playing. _Decision:_ keep it on until the stream ends, which also
  makes the PR's skeleton rows actually appear.
- **Direct-detail failure fell back to any source**: _Decision:_ wait for the
  URL's own source in the search stream; fall back to the first result only
  when the search ends without it (the pre-PR behaviour).
- **Banner copy said "faster" for a resolution upgrade** at equal speed.
  _Decision:_ separate copy — 发现更清晰的源 / "Sharper source found" for
  `quality-upgrade`, 发现更快的源 only for a speed lead.
- **`orderByCurrentEpisodeFirst` was a no-op** (callers filtered the same
  predicate). _Decision:_ replace with `measurableCurrentFirst`, which puts the
  current source first; with a stable sort, a score tie now keeps the current
  source instead of suggesting a switch.

Test-suite decisions:

- **`LADDER` seeded port 4110 while the mock listens on 4010**, so the advisory
  tests never used their seed and passed only because the real 720p/1080p
  manifests differ. _Decision:_ derive from `MOCK_PORT`; a new test asserts the
  banner shows the seeded value.
- **Console-error checks failed for reasons unrelated to the app**:
  navigation-cancelled fetches and the app's own internet requests (version
  check, Douban/Bangumi). _Decision:_ `test_play_perf.py` sets storage on
  `/login` instead of detouring through home, and counts only errors located on
  the app or mock origin; `test_av_filter.py` opens settings from `/search` and
  ignores "Failed to fetch" within 1.5 s of a navigation. Real failed `/api`
  requests still fail both suites.
- **`test_episode_switch_keeps_playing` asserted `... or True`.** _Decision:_
  assert the episode label changes and `currentTime` advances.
- **Chromium without H.264** cannot run the TTFF tests at all. _Decision:_
  `CODEC=vp9 bash tests/e2e/make-media.sh` (VP9 + Opus in fMP4, same playlist
  names) rather than switching the default fixtures, since real sources are
  H.264 and that is what the default should exercise.

### Open / not done

- ~~`.husky/*` hooks are committed without the executable bit, so git skips
  them on a fresh clone.~~ Fixed in the entry above; for this PR lint and
  prettier were run by hand.
- The `faster` advisory path cannot be exercised end to end: every mock source
  shares one of two ladder URLs, so equal-quality sources always measure
  identically. It is covered by the `decideSuggestion` unit tests.
- Release tagging `v3.10.0` is left to the maintainer.
