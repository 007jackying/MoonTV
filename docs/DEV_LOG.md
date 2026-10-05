# Dev log

Running log of checkpoints, checks, reviews and decisions. Newest first.
Each entry says what was checked, what was decided and why, and what is still
open, so a later change can tell whether a decision still holds.

---

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

- `.husky/*` hooks are committed without the executable bit, so git skips them
  on a fresh clone. Pre-existing; lint and prettier were run by hand for this
  PR.
- The `faster` advisory path cannot be exercised end to end: every mock source
  shares one of two ladder URLs, so equal-quality sources always measure
  identically. It is covered by the `decideSuggestion` unit tests.
- Release tagging `v3.10.0` is left to the maintainer.
