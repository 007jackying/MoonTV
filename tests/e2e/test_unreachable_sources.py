"""
End-to-end tests for folding unreachable sources in the source list.

A source whose speed test never connects, or connects but measures no
download speed, is moved out of the source list as soon as its result comes
in. It sits in a collapsed "显示 N 个无法连接的源" group at the end of the list,
which expands in place. Covered on every viewport the play page supports,
with screenshots of the collapsed and expanded list.

Runs against the same harness as test_failover.py (`node tests/e2e/serve.mjs`,
`perf` profile). Breakage is injected with Playwright request routing:

    perf profile   fast (720p)   mid (1080p)   dead (720p)   slow1 (720p)   slow2 (1080p)

We play `mid` and break the 720p ladder, so fast / dead / slow1 become the
unreachable ones and slow2 is the only other working source:

    BLOCK_720P       every 720p request aborts  -> speed test fails (never connected)
    BLOCK_720P_SEGS  only 720p segments abort   -> playlist loads, no measured speed

Screenshots land in tests/e2e/shots/unreachable-*.png (gitignored).

Run:  python -m pytest tests/e2e/test_unreachable_sources.py -v
"""

import os
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:4020")
PASSWORD = os.environ.get("E2E_PASSWORD", "111111")
TITLE = "%E6%B5%8B%E8%AF%95%E5%BD%B1%E7%89%87 Test Movie"
YEAR = "2024"
PLAY_MID = f"{BASE}/play?source=mid&id=mid-1&title={TITLE}&year={YEAR}&stype=tv"

# Scoped to the mock origin (a bare "**/media/**" also catches Next's fonts).
MOCK = f"http://127.0.0.1:{os.environ.get('MOCK_PORT', '4010')}"
BLOCK_720P = f"{MOCK}/media/720p/**"
BLOCK_720P_SEGS = f"{MOCK}/media/720p/seg_*"
UNREACHABLE = ("E2E-fast", "E2E-dead", "E2E-slow1")
REACHABLE = ("E2E-slow2",)

SHOTS = Path(__file__).parent / "shots"

# Copy from src/lib/i18n.ts (zh).
SHOW_PREFIX = "显示"
SHOW_SUFFIX = "个无法连接的源"
HIDE = "隐藏无法连接的源"

# name -> (viewport, touch). Same set as test_player_controls.py: widths
# straddle the play page's 1024 px desktop layout (side panel vs. card).
VIEWPORTS = {
    "phone-small": ({"width": 360, "height": 740}, True),
    "phone": ({"width": 390, "height": 844}, True),
    "phone-landscape-small": ({"width": 667, "height": 375}, True),
    "phone-landscape": ({"width": 844, "height": 390}, True),
    "tablet": ({"width": 768, "height": 1024}, True),
    "tablet-landscape": ({"width": 1180, "height": 820}, True),
    "laptop": ({"width": 1280, "height": 800}, False),
    "desktop": ({"width": 1440, "height": 900}, False),
}

# Every distinct label the toggle showed, in order: proves the group fills up
# while measurements arrive instead of appearing all at once at the end.
INIT_SCRIPT = """
window.__toggleLabels = [];
const check = () => {
  for (const b of document.querySelectorAll('button[aria-expanded]')) {
    const t = b.innerText.trim();
    if (t.includes('%s')) {
      const list = window.__toggleLabels;
      if (list[list.length - 1] !== t) list.push(t);
    }
  }
};
new MutationObserver(check).observe(document, {
  childList: true, subtree: true, characterData: true,
});
""" % SHOW_SUFFIX


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=True,
            executable_path=os.environ.get("E2E_CHROMIUM") or None,
            args=["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
        )
        yield b
        b.close()


def _new_page(browser, name="desktop", block=BLOCK_720P):
    viewport, touch = VIEWPORTS[name]
    ctx = browser.new_context(
        viewport=viewport,
        has_touch=touch,
        is_mobile=touch and viewport["width"] < 1024,
    )
    page = ctx.new_page()
    page.add_init_script(INIT_SCRIPT)
    if block:
        page.route(block, lambda route: route.abort())
    page.goto(f"{BASE}/login", wait_until="domcontentloaded")
    page.evaluate(
        """async (pw) => {
            await fetch('/api/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ password: pw }),
            });
            localStorage.removeItem('moontv_play_records');
            localStorage.removeItem('moontv_source_metrics');
            localStorage.setItem('enablePreferBestSource', 'false');
            localStorage.setItem('enableOptimization', 'true');
        }""",
        PASSWORD,
    )
    return ctx, page


def _open_source_list(page):
    """Expand the source list: 另有 N 个源 (side panel) or 换源 (mobile card)."""
    opener = page.locator(
        'button[aria-expanded="false"]:visible', has_text="另有"
    ).or_(page.locator('button[aria-expanded="false"]:visible', has_text="换源"))
    opener.first.wait_for(timeout=20000)
    opener.first.click()


def _toggle(page):
    return page.locator("button[aria-expanded]:visible").filter(
        has_text=SHOW_SUFFIX
    ).or_(page.locator("button[aria-expanded]:visible", has_text=HIDE))


def _row_names(page):
    """Visible source rows (other sources) top to bottom, by source name."""
    return page.locator(
        "button:visible span.truncate.text-\\[15px\\].font-bold"
    ).all_inner_texts()


def _wait_all_folded(page, n=len(UNREACHABLE)):
    """All broken sources folded, and slow2 (4s search) has arrived."""
    page.locator("button:visible", has_text=REACHABLE[-1]).first.wait_for(
        timeout=30000
    )
    page.wait_for_function(
        """(label) => [...document.querySelectorAll('button[aria-expanded]')]
              .some((b) => b.offsetParent && b.innerText.includes(label))""",
        arg=f"{n} {SHOW_SUFFIX}",
        timeout=30000,
    )


def _assert_fits(page, name):
    # No horizontal page scroll at this width.
    overflow = page.evaluate(
        "document.documentElement.scrollWidth - window.innerWidth"
    )
    assert overflow <= 1, f"{name}: page scrolls sideways by {overflow}px"
    box = _toggle(page).first.bounding_box()
    assert box, f"{name}: toggle not rendered"
    vw = VIEWPORTS[name][0]["width"]
    assert box["x"] >= 0 and box["x"] + box["width"] <= vw + 1, (
        f"{name}: toggle overflows the viewport {box}"
    )
    assert box["height"] >= 44, f"{name}: toggle is {box['height']}px tall"
    # Every header control is on screen (the 768 px top nav used to push the
    # language toggle and user menu off the right edge).
    off = page.evaluate(
        """() => [...document.querySelectorAll('header a, header button')]
              .filter((e) => e.offsetParent)
              .map((e) => e.getBoundingClientRect())
              .filter((r) => r.right > window.innerWidth + 1 || r.left < -1)
              .length"""
    )
    assert off == 0, f"{name}: {off} header controls are off screen"
    # ... and the search input keeps room to type in.
    search = page.locator("header input:visible")
    if search.count():
        w = search.first.bounding_box()["width"]
        assert w >= 100, f"{name}: header search input is only {w}px wide"
    # Label on one line, not clipped.
    clipped = _toggle(page).first.evaluate(
        "(b) => b.scrollWidth > b.clientWidth + 1"
    )
    assert not clipped, f"{name}: toggle label is clipped"


# ---------------------------------------------------------------------------


def test_unreachable_sources_are_folded_and_expand_at_the_end(browser):
    ctx, page = _new_page(browser)
    try:
        page.goto(PLAY_MID, wait_until="domcontentloaded")
        _open_source_list(page)
        _wait_all_folded(page)

        rows = _row_names(page)
        for n in UNREACHABLE:
            assert n not in rows, f"{n} still listed while folded: {rows}"
        assert rows[: len(REACHABLE)] == list(REACHABLE), rows

        _toggle(page).first.click()
        page.wait_for_selector(f"button:visible:has-text('{HIDE}')")
        rows = _row_names(page)
        # Expanded in place, after every reachable source.
        assert rows[: len(REACHABLE)] == list(REACHABLE), rows
        assert sorted(rows[len(REACHABLE):]) == sorted(UNREACHABLE), rows

        # Unreachable rows are still usable: they say why and can be picked.
        for n in UNREACHABLE:
            row = page.locator("button:visible", has_text=n).first
            assert "无测速数据" in row.inner_text()
            assert row.is_enabled()

        _toggle(page).first.click()
        page.wait_for_selector(f"button:visible:has-text('{SHOW_SUFFIX}')")
        rows = _row_names(page)
        assert not any(n in rows for n in UNREACHABLE), rows
    finally:
        ctx.close()


def test_group_fills_up_in_real_time(browser):
    """dead (1.5s) and slow1 (2.5s) arrive later than fast, so the count grows."""
    ctx, page = _new_page(browser)
    try:
        page.goto(PLAY_MID, wait_until="domcontentloaded")
        _open_source_list(page)
        _wait_all_folded(page)
        labels = page.evaluate("window.__toggleLabels")
        counts = [int(l.split()[1]) for l in labels if l.startswith(SHOW_PREFIX)]
        assert counts == sorted(counts), labels
        assert counts[-1] == len(UNREACHABLE), labels
        assert len(counts) >= 2, f"group appeared all at once: {labels}"
    finally:
        ctx.close()


def test_sources_with_no_measured_speed_are_folded_too(browser):
    """Playlist answers, segments do not: connected, but no network speed."""
    ctx, page = _new_page(browser, block=BLOCK_720P_SEGS)
    try:
        page.goto(PLAY_MID, wait_until="domcontentloaded")
        _open_source_list(page)
        _wait_all_folded(page)
        rows = _row_names(page)
        assert not any(n in rows for n in UNREACHABLE), rows
        assert "E2E-slow2" in rows, rows
    finally:
        ctx.close()


def test_nothing_folded_when_every_source_works(browser):
    ctx, page = _new_page(browser, block=None)
    try:
        page.goto(PLAY_MID, wait_until="domcontentloaded")
        _open_source_list(page)
        # Every other source measured with a real speed.
        page.wait_for_function(
            """() => [...document.querySelectorAll('button')]
                  .filter((b) => b.offsetParent && /KB\\/s|MB\\/s/.test(b.innerText)
                                 && b.querySelector('span.truncate'))
                  .length >= 4""",
            timeout=30000,
        )
        assert _toggle(page).count() == 0
    finally:
        ctx.close()


def test_choosing_a_folded_source_keeps_it_visible_while_switching(browser):
    ctx, page = _new_page(browser)
    try:
        page.goto(PLAY_MID, wait_until="domcontentloaded")
        _open_source_list(page)
        _wait_all_folded(page)
        _toggle(page).first.click()
        page.locator("button:visible", has_text="E2E-dead").first.click()
        page.wait_for_function(
            "() => new URLSearchParams(location.search).get('source') === 'dead'"
            " || document.body.innerText.includes('切换中')",
            timeout=10000,
        )
    finally:
        ctx.close()


@pytest.mark.parametrize("name", list(VIEWPORTS))
def test_layout_on_every_viewport(browser, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    ctx, page = _new_page(browser, name)
    try:
        page.goto(PLAY_MID, wait_until="domcontentloaded")
        _open_source_list(page)
        _wait_all_folded(page)
        toggle = _toggle(page).first
        toggle.scroll_into_view_if_needed()
        _assert_fits(page, name)
        page.screenshot(path=str(SHOTS / f"unreachable-{name}-collapsed.png"))

        if VIEWPORTS[name][1]:
            toggle.tap()
        else:
            toggle.click()
        page.wait_for_selector(f"button:visible:has-text('{HIDE}')")
        last = page.locator("button:visible", has_text=UNREACHABLE[-1]).first
        last.scroll_into_view_if_needed()
        _assert_fits(page, name)
        # Rows fit the viewport too.
        for n in UNREACHABLE:
            b = page.locator("button:visible", has_text=n).first.bounding_box()
            assert b and b["x"] >= 0 and b["x"] + b["width"] <= VIEWPORTS[name][0]["width"] + 1, (
                f"{name}: row {n} overflows {b}"
            )
        page.screenshot(path=str(SHOTS / f"unreachable-{name}-expanded.png"))
    finally:
        ctx.close()
