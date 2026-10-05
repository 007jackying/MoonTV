# Dev log

Running log of checkpoints, checks, reviews and decisions. Newest first.
Each entry says what was checked, what was decided and why, and what is still
open, so a later change can tell whether a decision still holds.

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
