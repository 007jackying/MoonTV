"""
End-to-end tests for automatic failover on the play page.

When the playing source fails (first load or after recovery gives up), the
page must switch to the next working source on its own, and the source panel
must list tested-and-working sources first.

Runs against the same harness as test_play_perf.py (`node tests/e2e/serve.mjs`,
`perf` profile). Breakage is injected in the browser with Playwright request
routing rather than in the mock, so the other suites are unaffected:

    perf profile   fast (720p)   mid (1080p)   dead (720p)   slow1 (720p)   slow2 (1080p)

Blocking `/media/720p/` breaks fast, dead and slow1 for both the player and
the speed test (exactly what a dead upstream looks like), leaving mid and
slow2 as the only playable sources.

Run:  python -m pytest tests/e2e/test_failover.py -v
"""

import os

import pytest
from playwright.sync_api import sync_playwright

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:4020")
PASSWORD = os.environ.get("E2E_PASSWORD", "111111")
TITLE = "%E6%B5%8B%E8%AF%95%E5%BD%B1%E7%89%87 Test Movie"
YEAR = "2024"
PLAY_FAST = f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}&stype=tv"

# Scoped to the mock origin: a bare "**/media/**" would also catch Next's own
# /_next/static/media/ (fonts) and render the page in fallback fonts.
MOCK = f"http://127.0.0.1:{os.environ.get('MOCK_PORT', '4010')}"
BLOCK_720P = f"{MOCK}/media/720p/**"
BLOCK_ALL_MEDIA = f"{MOCK}/media/**"
WORKING_SOURCES = ("mid", "slow2")

# Copy from src/lib/i18n.ts (zh).
FINDING_NEXT = "正在自动切换到下一个可用的播放源"
SWITCHED_TO = "已自动切换到"
ALL_FAILED = "暂时没有找到可以播放的源"
CANNOT_PLAY = "无法播放"
NO_SPEED_DATA = "无测速数据"

# Recorded in the page rather than polled:
#   __seen     text that appears and disappears faster than a poll can catch
#              (the failover status is gone as soon as a tested source exists)
#   __sources  every source the page committed to, in order. The page rewrites
#              `?source=` with history.replaceState on load and on each switch,
#              so this is the exact failover sequence.
INIT_SCRIPT = """
window.__seen = {};
window.__sources = [];
const WATCH = %s;
const check = () => {
  const text = document.body ? document.body.innerText : '';
  for (const w of WATCH) if (text.includes(w)) window.__seen[w] = true;
};
new MutationObserver(check).observe(document, {
  childList: true, subtree: true, characterData: true,
});
const replace = history.replaceState.bind(history);
history.replaceState = function (state, title, url) {
  try {
    const src = new URL(url, location.href).searchParams.get('source');
    const list = window.__sources;
    if (src && list[list.length - 1] !== src) list.push(src);
  } catch (e) {}
  return replace(state, title, url);
};
""" % repr(
    [FINDING_NEXT, SWITCHED_TO, ALL_FAILED, "发现更快的源", "发现更清晰的源"]
)

PLAYING = """() => {
  const v = document.querySelector('video');
  return !!v && v.readyState >= 3 && !v.paused && v.currentTime > 0.2;
}"""


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=True,
            # See tests/e2e/README.md: optional preinstalled Chromium.
            executable_path=os.environ.get("E2E_CHROMIUM") or None,
            args=["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
        )
        # Warm-up so route compilation under `next dev` does not eat the
        # first test's time budget.
        ctx, page = _new_page(b)
        page.goto(PLAY_FAST, wait_until="domcontentloaded")
        page.wait_for_timeout(4000)
        ctx.close()
        yield b
        b.close()


def _new_page(browser, *, block=None, optimization=True):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.add_init_script(INIT_SCRIPT)
    if block:
        page.route(block, lambda route: route.abort())
    page.goto(f"{BASE}/login", wait_until="domcontentloaded")
    page.evaluate(
        """async ([pw, optimization]) => {
            await fetch('/api/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ password: pw }),
            });
            localStorage.removeItem('moontv_play_records');
            localStorage.removeItem('moontv_source_metrics');
            localStorage.setItem('enablePreferBestSource', 'false');
            localStorage.setItem('enableOptimization', JSON.stringify(optimization));
        }""",
        [PASSWORD, optimization],
    )
    return ctx, page


def _current_source(page) -> str:
    return page.evaluate("new URLSearchParams(location.search).get('source')")


def _seen(page, text) -> bool:
    return bool(page.evaluate("(t) => !!window.__seen[t]", text))


def _tried(page) -> list:
    return page.evaluate("window.__sources")


def _wait_switched_and_playing(page, timeout_ms=30000):
    page.wait_for_function(
        "(ok) => ok.includes(new URLSearchParams(location.search).get('source'))",
        arg=list(WORKING_SOURCES),
        timeout=timeout_ms,
    )
    page.wait_for_function(PLAYING, timeout=timeout_ms)


def _source_rows(page):
    """Rows of the "other sources" list, top to bottom, as single-line text."""
    page.locator('button:has-text("另有")').first.click()
    rows = page.locator("button:has(span.truncate.text-\\[15px\\].font-bold)")
    rows.first.wait_for()
    return [" | ".join(t.split("\n")) for t in rows.all_inner_texts()]


# ---------------------------------------------------------------------------


def test_failed_first_source_switches_to_a_working_one(browser):
    """The reported bug: landing on a dead source must not strand the user."""
    ctx, page = _new_page(browser, block=BLOCK_720P)
    try:
        page.goto(PLAY_FAST, wait_until="commit")
        _wait_switched_and_playing(page)
        assert page.locator("video").count() == 1
        # The error card said what was happening ...
        assert _seen(page, FINDING_NEXT), "failover status was never shown"
        # ... and once playing, a notice names the source it switched to.
        page.wait_for_function(
            "(t) => !!window.__seen[t]", arg=SWITCHED_TO, timeout=5000
        )
    finally:
        ctx.close()


def test_picks_a_tested_working_source_not_the_next_in_list(browser):
    """
    dead (1.5s) and slow1 (2.5s) reach the panel before slow2 and are next in
    list order, but they measure as broken. With speed tests on, failover must
    wait for a tested source instead of walking the list: exactly one switch.
    """
    ctx, page = _new_page(browser, block=BLOCK_720P)
    try:
        page.goto(PLAY_FAST, wait_until="commit")
        _wait_switched_and_playing(page)
        tried = _tried(page)
        assert tried[0] == "fast", tried
        assert len(tried) == 2 and tried[1] in WORKING_SOURCES, (
            f"expected one switch straight to a working source, got {tried}"
        )
    finally:
        ctx.close()


def test_panel_lists_working_sources_first_after_a_failure(browser):
    ctx, page = _new_page(browser, block=BLOCK_720P)
    try:
        page.goto(PLAY_FAST, wait_until="commit")
        _wait_switched_and_playing(page)
        # Let the slowest source (4s) arrive and get measured.
        page.wait_for_timeout(6000)
        rows = _source_rows(page)
        assert len(rows) == 4, rows

        def tier(row):
            if CANNOT_PLAY in row:
                return 3  # failed in the player
            if NO_SPEED_DATA in row:
                return 2  # speed test failed
            if "/s" in row:
                return 0  # tested and working
            return 1  # untested

        tiers = [tier(r) for r in rows]
        assert tiers == sorted(tiers), f"panel not sorted by health: {rows}"
        assert tiers[0] == 0, f"first row is not a working source: {rows}"
        assert "E2E-fast" in rows[-1] and CANNOT_PLAY in rows[-1], rows
    finally:
        ctx.close()


def test_failed_source_is_never_retried_automatically(browser):
    ctx, page = _new_page(browser, block=BLOCK_720P)
    try:
        page.goto(PLAY_FAST, wait_until="commit")
        _wait_switched_and_playing(page)
        # Past the full search and every measurement.
        page.wait_for_timeout(8000)
        tried = _tried(page)
        assert tried.count("fast") == 1, tried
        assert tried[-1] in WORKING_SOURCES, tried
        page.wait_for_function(PLAYING, timeout=5000)
    finally:
        ctx.close()


def test_without_speed_tests_falls_back_to_list_order(browser):
    """
    enableOptimization=false: there are no measurements to rank by, so
    failover walks the list. It may pass through dead / slow1 (also broken)
    before a 1080p source, but never revisits one.
    """
    ctx, page = _new_page(browser, block=BLOCK_720P, optimization=False)
    try:
        page.goto(PLAY_FAST, wait_until="commit")
        _wait_switched_and_playing(page, timeout_ms=45000)
        tried = _tried(page)
        assert len(tried) == len(set(tried)), f"a source was retried: {tried}"
        assert tried[-1] in WORKING_SOURCES, tried
    finally:
        ctx.close()


def test_every_source_failing_ends_with_a_clear_message(browser):
    ctx, page = _new_page(browser, block=BLOCK_ALL_MEDIA)
    try:
        page.goto(PLAY_FAST, wait_until="commit")
        page.wait_for_selector(f"text={ALL_FAILED}", timeout=90000)
        body = page.inner_text("body")
        # Still the play page, not the full-page error screen.
        assert page.locator("video").count() == 1
        assert "Test Movie" in body
        # The manual way out is still offered.
        assert page.locator("button", has_text="换源").count() >= 1
        # Every source tried at most once, then it stopped.
        tried = _tried(page)
        assert len(tried) == len(set(tried)), f"a source was retried: {tried}"
        assert len(tried) <= 6, f"more than 5 automatic switches: {tried}"
        page.wait_for_timeout(5000)
        assert _tried(page) == tried, "kept switching after giving up"
    finally:
        ctx.close()


def test_no_better_source_banner_while_the_current_one_is_failing(browser):
    """
    The advisory compares candidates against a *working* current source. A
    failed one is failover's job, so the banner must never show up for it,
    and must not point at a source that already failed in the player.
    """
    ctx, page = _new_page(browser, block=BLOCK_720P)
    try:
        page.goto(PLAY_FAST, wait_until="commit")
        _wait_switched_and_playing(page)
        # Past the end of the search, when the advisory measurement runs.
        page.wait_for_timeout(6000)
        for banner in ("发现更快的源", "发现更清晰的源"):
            assert not _seen(page, banner), f"advisory shown during failover: {banner}"
    finally:
        ctx.close()


def test_failover_on_first_load_keeps_the_saved_position(browser):
    """
    Opening a title from 继续观看 on a source that turns out to be dead: the
    player fails before it ever plays, so its currentTime is still 0. Failover
    must resume the next source at the saved position, and the saved record
    must move to that source instead of being deleted.
    """
    ctx, page = _new_page(browser, block=BLOCK_720P)
    try:
        page.evaluate(
            """() => localStorage.setItem('moontv_play_records', JSON.stringify({
                'fast+fast-1': {
                  title: '测试影片 Test Movie', source_name: 'E2E-fast', cover: '',
                  year: '2024', index: 1, total_episodes: 12, play_time: 7,
                  total_time: 12, save_time: Date.now(), search_title: '',
                },
            }))"""
        )
        page.goto(PLAY_FAST, wait_until="commit")
        _wait_switched_and_playing(page)
        t = page.evaluate("document.querySelector('video').currentTime")
        assert t >= 6, f"resumed at {t:.2f}s instead of the saved 7s"
        new_key = f"{_current_source(page)}+"
        page.wait_for_function(
            """(prefix) => Object.entries(
                 JSON.parse(localStorage.getItem('moontv_play_records') || '{}')
               ).some(([k, r]) => k.startsWith(prefix) && r.play_time >= 6)""",
            arg=new_key,
            timeout=8000,
        )
    finally:
        ctx.close()
