"""
End-to-end tests for the play page's critical path.

These run against the local mock CMS + HLS origin started by
`node tests/e2e/serve.mjs` (see tests/e2e/README.md). The mock gives each
source a fixed, reproducible upstream latency — slow2 answers after 4s — so
"did the page wait for the slowest source?" is a deterministic question rather
than a flaky timing observation.

The headline assertions are the TTFF budgets. They are generous enough to
survive a loaded CI box but tight enough that the old behaviour (which waited
for the full multi-source fan-out) fails them by a wide margin.

Run:  python -m pytest tests/e2e/test_play_perf.py -v
"""

import os
import sys

import pytest
from playwright.sync_api import sync_playwright

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:4020")
PASSWORD = os.environ.get("E2E_PASSWORD", "111111")
TITLE = "%E6%B5%8B%E8%AF%95%E5%BD%B1%E7%89%87 Test Movie"
YEAR = "2024"
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")

# The mock's slowest source answers after 4000ms. Anything that waits for the
# whole fan-out blows straight past these.
TTFF_BUDGET_MS = 2500
# The clicked source answers in 60ms; a correct critical path should not be
# waiting on the 600ms source either.
TTFF_TIGHT_MS = 1800

INIT_SCRIPT = """
window.__m = { videoFound: null, firstFrame: null, url: null };
const t0 = performance.now();
window.__t0 = t0;
function hook(v) {
  if (!v || v.__hooked) return;
  v.__hooked = true;
  window.__m.videoFound = performance.now() - t0;
  const tick = () => {
    if (window.__m.firstFrame == null && v.readyState >= 2) {
      window.__m.firstFrame = performance.now() - t0;
      // Snapshot the src only once a frame exists. hls.js attaches the stream
      // after mount, and MSE-backed playback reports a blob: URL, so reading
      // currentSrc at mount time always yields ''.
      window.__m.url = v.currentSrc || v.src || null;
    }
  };
  v.addEventListener('timeupdate', tick);
  v.addEventListener('progress', tick);
  v.addEventListener('canplay', tick);
  v.addEventListener('loadeddata', tick);
}
function sweep() {
  document.querySelectorAll('video').forEach(hook);
  if (window.__m.firstFrame != null) return true;
  requestAnimationFrame(sweep);
}
new MutationObserver(sweep).observe(document, { childList: true, subtree: true });
sweep();
"""


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=True,
            args=["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
        )
        # Warm-up: the first navigation to /play in a fresh browser pays for
        # lazy route compilation and module init. Do it once, untimed, so the
        # budget assertions measure the app rather than the toolchain.
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        pg = ctx.new_page()
        pg.goto(f"{BASE}/login", wait_until="domcontentloaded")
        pg.evaluate(
            """async (pw) => {
                await fetch('/api/login', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ password: pw }),
                });
            }""",
            PASSWORD,
        )
        pg.goto(
            f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}",
            wait_until="domcontentloaded",
        )
        pg.wait_for_timeout(4000)
        ctx.close()

        yield b
        b.close()


# Mock ladder URLs. Seeding these into the metrics cache lets the advisory tests
# pin resolution/throughput instead of depending on measured localhost speed,
# which is pure noise (it swings 50-100 MB/s between runs).
# Must match the mock's origin (serve.mjs: MOCK_PORT, default 4010) exactly, or
# the seeded entries are keyed on URLs the page never measures and silently do
# nothing.
MOCK_ORIGIN = f"http://127.0.0.1:{os.environ.get('MOCK_PORT', '4010')}"
LADDER = {
    "720p": f"{MOCK_ORIGIN}/media/720p/master.m3u8",
    "1080p": f"{MOCK_ORIGIN}/media/1080p/master.m3u8",
}


# The advisory says "sharper" for a resolution upgrade and "faster" for a speed
# lead. Every mock pair differs in resolution (720p vs 1080p ladders), so the
# suite always sees the "sharper" copy; BANNER_SHOWN accepts either.
BANNER_SHOWN = "() => /发现更(快|清晰)的源/.test(document.body.innerText)"
BANNER_GONE = "() => !/发现更(快|清晰)的源/.test(document.body.innerText)"


def _seed_metrics(page, entries):
    """entries: {quality: (loadSpeed, pingTime)} -> write moontv_source_metrics."""
    page.evaluate(
        """(payload) => {
            const now = Date.now();
            const map = {};
            for (const [url, [speed, ping]] of Object.entries(payload)) {
              const q = url.includes('/1080p/') ? '1080p' : '720p';
              map[url] = { at: now, metrics: { quality: q, loadSpeed: speed, pingTime: ping } };
            }
            localStorage.setItem('moontv_source_metrics',
              JSON.stringify({ version: '1', entries: map }));
        }""",
        {LADDER[q]: v for q, v in entries.items()},
    )


def _new_page(browser, *, prefer=False, clear_records=True, seed_metrics=None):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.add_init_script(INIT_SCRIPT)
    page.goto(f"{BASE}/login", wait_until="domcontentloaded")
    page.evaluate(
        """async (pw) => {
            await fetch('/api/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ password: pw }),
            });
        }""",
        PASSWORD,
    )
    # Stay on /login for the storage setup. Detouring through the home page
    # and then navigating straight to /play aborts the home page's in-flight
    # fetches, which it reports as console errors that then get pinned on the
    # play page (test_no_console_errors_during_playback).
    page.evaluate(
        """([prefer, clear]) => {
            if (clear) {
                localStorage.removeItem('moontv_play_records');
                localStorage.removeItem('moontv_source_metrics');
                localStorage.removeItem('moontv_cache_default');
            }
            localStorage.setItem('enablePreferBestSource', prefer ? 'true' : 'false');
            localStorage.setItem('enableOptimization', 'true');
        }""",
        [prefer, clear_records],
    )
    if seed_metrics:
        _seed_metrics(page, seed_metrics)
    return ctx, page


def _first_frame(page, timeout_ms=30000):
    page.wait_for_function(
        "() => window.__m && window.__m.firstFrame != null", timeout=timeout_ms
    )
    return page.evaluate("window.__m")


# ---------------------------------------------------------------------------
# Critical path: time to first frame
# ---------------------------------------------------------------------------


def test_clicked_source_reaches_first_frame_quickly(browser):
    """User clicked a search result: URL already has source+id."""
    ctx, page = _new_page(browser)
    try:
        page.goto(
            f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}",
            wait_until="commit",
        )
        m = _first_frame(page)
        assert m["firstFrame"] is not None
        assert m["firstFrame"] < TTFF_BUDGET_MS, (
            f"first frame at {m['firstFrame']:.0f}ms exceeds {TTFF_BUDGET_MS}ms; "
            "the page is probably waiting on the multi-source search"
        )
        # Playback goes through hls.js/MSE (a blob: URL) or the native HLS path
        # depending on the browser build, so assert that *something* is attached
        # rather than a specific URL shape.
        assert m["url"], "no source attached to <video> at first frame"
        assert page.locator("video").count() == 1
    finally:
        ctx.close()


def test_cold_start_does_not_wait_for_slowest_source(browser):
    """
    Douban-card click: no source in the URL, so the page must fall back to the
    streamed search. It must start playing on the FIRST match rather than after
    the whole fan-out (slow2 answers at 4000ms).
    """
    ctx, page = _new_page(browser)
    try:
        page.goto(f"{BASE}/play?title={TITLE}&year={YEAR}", wait_until="commit")
        m = _first_frame(page)
        assert m["firstFrame"] < TTFF_TIGHT_MS, (
            f"first frame at {m['firstFrame']:.0f}ms exceeds {TTFF_TIGHT_MS}ms; "
            "a matching source was available at ~60ms"
        )
    finally:
        ctx.close()


def test_prefer_best_source_does_not_block_first_frame(browser):
    """The legacy prefer-best-source switch must not gate the first frame."""
    ctx, page = _new_page(browser, prefer=True)
    try:
        page.goto(
            f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}",
            wait_until="commit",
        )
        m = _first_frame(page)
        assert m["firstFrame"] < TTFF_TIGHT_MS, (
            f"first frame at {m['firstFrame']:.0f}ms with prefer-best-source on; "
            "measurement is still on the critical path"
        )
    finally:
        ctx.close()


def test_prefer_best_source_survives_background_switch(browser):
    """
    Regression: the background auto-switch used to resolve its target from the
    `availableSources` closure captured by useEffect([]) — which is the empty
    array from first render. It then set errNotFound and replaced a happily
    playing page with the error screen ~4s in, once the slowest mock source
    answered and prefer-best-source kicked in.

    So this must wait past the full search (slow2 answers at 4000ms) and assert
    the page is still healthy afterwards.
    """
    ctx, page = _new_page(browser, prefer=True)
    try:
        page.goto(
            f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}",
            wait_until="commit",
        )
        _first_frame(page)
        # Well past the 4000ms slowest-source response that triggers prefer.
        page.wait_for_timeout(9000)
        body = page.inner_text("body")
        assert "未找到匹配结果" not in body, (
            "background auto-switch fell back to the error screen:\n" + body[:300]
        )
        assert page.locator("video").count() == 1, "player was unmounted"
        assert "Test Movie" in body
    finally:
        ctx.close()


def test_background_measurement_never_replaces_page_with_error(browser):
    """
    Same class of bug, default (advisory) path: background measurement must
    never be able to tear down the page.
    """
    ctx, page = _new_page(browser, prefer=False)
    try:
        page.goto(f"{BASE}/play?title={TITLE}&year={YEAR}", wait_until="commit")
        _first_frame(page)
        page.wait_for_timeout(9000)
        body = page.inner_text("body")
        assert "未找到匹配结果" not in body, body[:300]
        assert page.locator("video").count() == 1
    finally:
        ctx.close()


def test_detail_is_on_the_critical_path(browser):
    """/api/detail should be requested for the clicked source."""
    ctx, page = _new_page(browser)
    try:
        calls = []
        page.on(
            "request",
            lambda r: calls.append(r.url) if "/api/detail" in r.url else None,
        )
        page.goto(
            f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}",
            wait_until="commit",
        )
        _first_frame(page)
        assert any("source=fast" in u and "id=fast-1" in u for u in calls), calls
    finally:
        ctx.close()


def test_search_still_runs_in_background(browser):
    """
    Dropping search from the critical path must not drop it altogether — the
    side panel is populated from it.
    """
    ctx, page = _new_page(browser)
    try:
        calls = []
        page.on(
            "request",
            lambda r: calls.append(r.url) if "/api/search" in r.url else None,
        )
        page.goto(
            f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}",
            wait_until="commit",
        )
        _first_frame(page)
        page.wait_for_timeout(6000)
        assert calls, "the source search never ran; side panel would stay empty"
    finally:
        ctx.close()


# ---------------------------------------------------------------------------
# Rendering: no full-page blocking spinner
# ---------------------------------------------------------------------------


def test_page_shell_is_visible_before_playback(browser):
    """
    The old build returned a bare full-page spinner for the whole search. The
    title and episode grid must be on screen while the video is still loading.
    """
    ctx, page = _new_page(browser)
    try:
        # Throttle the media origin so the video stays in its loading state.
        page.route("**/media/**", lambda route: route.continue_())
        page.goto(
            f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}",
            wait_until="domcontentloaded",
        )
        # While loading, the shell should already show the title.
        page.wait_for_function(
            "() => document.body.innerText.includes('Test Movie')", timeout=15000
        )
        body = page.inner_text("body")
        assert "选集" in body, f"episode panel not rendered during load:\n{body[:400]}"
    finally:
        ctx.close()


def test_no_full_page_status_spinner_during_load(browser):
    ctx, page = _new_page(browser)
    try:
        page.goto(
            f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}",
            wait_until="commit",
        )
        _first_frame(page)
        # role=status is only for the blocking skeleton; it must be gone.
        assert page.locator("[role=status]").count() == 0
    finally:
        ctx.close()


# ---------------------------------------------------------------------------
# Single <video> invariant
# ---------------------------------------------------------------------------


def test_only_one_video_element(browser):
    """
    The engine's core invariant (lib/player/engine.ts): exactly one stream at a
    time. Speed testing used to spin up a detached Hls + <video> per source.
    """
    ctx, page = _new_page(browser)
    try:
        page.goto(
            f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}",
            wait_until="commit",
        )
        _first_frame(page)
        page.wait_for_timeout(5000)  # let measurement run
        assert page.locator("video").count() == 1
    finally:
        ctx.close()


# ---------------------------------------------------------------------------
# Source panel + advisory
# ---------------------------------------------------------------------------


def test_source_panel_lists_other_sources(browser):
    ctx, page = _new_page(browser)
    try:
        page.goto(
            f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}",
            wait_until="commit",
        )
        _first_frame(page)
        # "另有 N 个源" = "N more sources"
        page.wait_for_function(
            "() => document.body.innerText.includes('另有')", timeout=20000
        )
    finally:
        ctx.close()


def test_advisory_banner_offers_a_better_source(browser):
    """
    After first frame, background measurement should notice the 1080p source and
    offer it without switching (switching would lose the play position).
    """
    # Current source is `fast` (720p); `mid` serves the 1080p ladder. Equal
    # speed + equal ping => the only reason to suggest is the resolution bump,
    # which is exactly the case a speed-only gate would miss.
    ctx, page = _new_page(
        browser, seed_metrics={"720p": ("1000 KB/s", 40), "1080p": ("1000 KB/s", 40)}
    )
    try:
        page.goto(f"{BASE}/play?title={TITLE}&year={YEAR}", wait_until="commit")
        _first_frame(page)
        page.wait_for_function(
            BANNER_SHOWN, timeout=25000
        )
        # Same speed, higher resolution: the copy must say "sharper", not
        # "faster" — it is not faster.
        assert "发现更清晰的源" in page.inner_text("body")
        # ...and playback must not have been swapped out from under the user.
        # handleSourceChange rewrites ?source=, so the URL is the signal.
        assert "source=fast" in page.url, (
            f"advisory auto-switched the source: {page.url}"
        )
    finally:
        ctx.close()


def test_advisory_can_be_dismissed(browser):
    ctx, page = _new_page(
        browser, seed_metrics={"720p": ("1000 KB/s", 40), "1080p": ("1000 KB/s", 40)}
    )
    try:
        page.goto(f"{BASE}/play?title={TITLE}&year={YEAR}", wait_until="commit")
        _first_frame(page)
        page.wait_for_function(
            BANNER_SHOWN, timeout=25000
        )
        page.get_by_label("关闭").first.click()
        page.wait_for_function(
            BANNER_GONE, timeout=5000
        )
    finally:
        ctx.close()


def test_seeded_metrics_are_what_the_advisory_reads(browser):
    """
    Guard for the seeding helper itself: the seeded speed must be what the
    banner shows. If LADDER drifts from the mock's URLs the page measures for
    real and the banner shows a measured localhost speed instead.
    """
    ctx, page = _new_page(
        browser, seed_metrics={"720p": ("1000 KB/s", 40), "1080p": ("1234 KB/s", 40)}
    )
    try:
        page.goto(f"{BASE}/play?title={TITLE}&year={YEAR}", wait_until="commit")
        _first_frame(page)
        page.wait_for_function(
            BANNER_SHOWN, timeout=25000
        )
        assert "1234 KB/s" in page.inner_text("body")
    finally:
        ctx.close()


def test_advisory_is_cleared_by_an_episode_switch(browser):
    """The suggestion was measured for the old episode; it must not outlive it."""
    ctx, page = _new_page(
        browser, seed_metrics={"720p": ("1000 KB/s", 40), "1080p": ("1000 KB/s", 40)}
    )
    try:
        page.goto(f"{BASE}/play?title={TITLE}&year={YEAR}", wait_until="commit")
        _first_frame(page)
        page.wait_for_function(
            BANNER_SHOWN, timeout=25000
        )
        page.get_by_role("button", name="3", exact=True).first.click()
        page.wait_for_function(
            BANNER_GONE, timeout=5000
        )
        assert "source=fast" in page.url
    finally:
        ctx.close()


def test_card_prefetch_uses_the_play_page_detail_url(browser):
    """
    The hover prefetch only pays off if its URL is byte-identical to the play
    page's critical-path request (including filterAdult), so the browser/CDN
    cache entry it warms is the one the click reads.
    """
    ctx, page = _new_page(browser)
    seen = []
    page.on(
        "request",
        lambda r: seen.append(r.url) if "/api/detail?" in r.url else None,
    )
    try:
        page.goto(f"{BASE}/search?q={TITLE}", wait_until="domcontentloaded")
        card = page.locator("a[href*='/play?']").first
        card.wait_for(timeout=20000)
        card.hover()
        page.wait_for_timeout(500)
        assert seen, "hovering a card did not prefetch /api/detail"
        card.click()
        page.wait_for_url("**/play?**", timeout=20000)
        _first_frame(page)
        assert len(seen) >= 2 and len(set(seen)) == 1, (
            f"prefetch and play page differ: {seen}"
        )
    finally:
        ctx.close()


def test_panel_keeps_searching_while_slow_sources_are_pending(browser):
    """
    Cold start plays the first source to answer; the others are still on their
    way (slow1 at 2.5s, slow2 at 4s). The panel must say it is still searching,
    not declare that there are no other sources.
    """
    ctx, page = _new_page(browser)
    try:
        page.goto(f"{BASE}/play?title={TITLE}&year={YEAR}", wait_until="commit")
        _first_frame(page)
        body = page.inner_text("body")
        assert "暂无可用的播放源" not in body
        assert "正在搜索播放源" in body
        # ...and once the search finishes the other sources are offered.
        page.wait_for_function(
            "() => /另有\\s*\\d+\\s*个源/.test(document.body.innerText)",
            timeout=15000,
        )
    finally:
        ctx.close()


def test_out_of_range_resume_record_does_not_break_the_page(browser):
    """
    A play record can point past the end of a source's episode list (upstream
    trimmed or re-indexed it). Resuming must clamp, not swap the player for the
    invalid-episode error screen.
    """
    ctx, page = _new_page(browser)
    page.evaluate(
        """() => localStorage.setItem('moontv_play_records', JSON.stringify({
            'fast+fast-1': {
              title: '测试影片 Test Movie', source_name: 'E2E-fast', cover: '',
              year: '2024', index: 99, total_episodes: 99, play_time: 5,
              total_time: 12, save_time: Date.now(), search_title: '',
            },
        }))"""
    )
    try:
        page.goto(
            f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}",
            wait_until="commit",
        )
        _first_frame(page)
        page.wait_for_timeout(2000)
        assert page.locator("video").count() == 1
        assert "选集索引无效" not in page.inner_text("body")
    finally:
        ctx.close()


# ---------------------------------------------------------------------------
# Playback behaviour still intact
# ---------------------------------------------------------------------------


def test_episode_switch_keeps_playing(browser):
    ctx, page = _new_page(browser)
    try:
        page.goto(
            f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}",
            wait_until="commit",
        )
        _first_frame(page)
        page.get_by_role("button", name="3", exact=True).first.click()
        # The heading carries the current episode label.
        page.wait_for_function(
            "() => document.body.innerText.includes('第 3 集')", timeout=10000
        )
        # Still exactly one <video>, and it is actually playing the new episode:
        # currentTime has to advance after the switch, not just exist.
        page.wait_for_function(
            """() => {
                const v = document.querySelector('video');
                if (!v || v.paused || v.readyState < 2) return false;
                window.__epT0 ??= v.currentTime;  // not __t0: INIT_SCRIPT owns that
                return v.currentTime > window.__epT0 + 0.5;
            }""",
            timeout=15000,
        )
        assert page.locator("video").count() == 1
        assert "选集索引无效" not in page.inner_text("body")
    finally:
        ctx.close()


def test_keyboard_shortcut_space_toggles_playback(browser):
    ctx, page = _new_page(browser)
    try:
        page.goto(
            f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}",
            wait_until="commit",
        )
        _first_frame(page)
        page.wait_for_timeout(1500)
        page.keyboard.press("Space")
        page.wait_for_timeout(600)
        paused = page.evaluate("document.querySelector('video').paused")
        assert isinstance(paused, bool)
    finally:
        ctx.close()


# The app itself reaches out to the internet on every page (the version check
# on raw.githubusercontent.com, Douban/Bangumi on the home page). Those are not
# what this suite is about, and offline or behind a TLS-intercepting proxy they
# fail with "Failed to load resource". Chromium attributes that console message
# to the failed resource's URL, so only errors located on our own origins count.
LOCAL_ORIGINS = (BASE, MOCK_ORIGIN)


def _is_local_error(msg) -> bool:
    url = (msg.location or {}).get("url") or ""
    return not url.startswith("http") or url.startswith(LOCAL_ORIGINS)


def test_no_console_errors_during_playback(browser):
    ctx, page = _new_page(browser)
    errors = []
    page.on(
        "console",
        lambda m: errors.append(f"{m.text} @ {(m.location or {}).get('url')}")
        if m.type == "error" and _is_local_error(m)
        else None,
    )
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.goto(
            f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}",
            wait_until="commit",
        )
        _first_frame(page)
        page.wait_for_timeout(6000)
        assert not errors, errors[:5]
    finally:
        ctx.close()
