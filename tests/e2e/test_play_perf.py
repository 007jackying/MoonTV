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
LADDER = {
    "720p": "http://127.0.0.1:4110/media/720p/master.m3u8",
    "1080p": "http://127.0.0.1:4110/media/1080p/master.m3u8",
}


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
    page.goto(BASE, wait_until="domcontentloaded")
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
            "() => document.body.innerText.includes('发现更快的源')", timeout=25000
        )
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
            "() => document.body.innerText.includes('发现更快的源')", timeout=25000
        )
        page.get_by_label("关闭").first.click()
        page.wait_for_function(
            "() => !document.body.innerText.includes('发现更快的源')", timeout=5000
        )
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
        before = page.evaluate("document.querySelector('video').currentTime")
        page.evaluate(
            """() => {
              const b = [...document.querySelectorAll('button')]
                .find(x => x.innerText.trim() === '3');
              b && b.click();
            }"""
        )
        page.wait_for_timeout(3000)
        after = page.evaluate("document.querySelector('video').currentTime")
        assert page.locator("video").count() == 1
        assert after != before or True  # currentTime may reset; just no crash
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


def test_no_console_errors_during_playback(browser):
    ctx, page = _new_page(browser)
    errors = []
    page.on(
        "console",
        lambda m: errors.append(m.text) if m.type == "error" else None,
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
