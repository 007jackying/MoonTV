"""
End-to-end tests for the player's 10-second seek controls.

The two buttons beside play/pause skip back / forward 10 s (they used to jump
to the previous / next episode). On touch screens, double-tapping the left or
right third of the video seeks back / forward 10 s, YouTube style: each
further tap on the same side within the chain window adds another 10 s, and a
double tap in the middle third still toggles play / pause. On touch screens
the three buttons (back 10, play / pause, forward 10) sit in the centre of the
video, YouTube-mobile style, and show / hide with the rest of the controls;
with a mouse they stay at the left of the bottom bar. Mouse input keeps its old
behaviour (click = play / pause, double-click = fullscreen), and episode
navigation stays on Alt + ← / → and the episode grid.

Every viewport the app supports is covered: phones in portrait and
landscape, tablets, and desktop. The player's compact layout is decided by
width (< 768 px); touch handling by the pointer type, not the width, so a
landscape phone (wider than 768 px) still double-taps to seek, and the
centred layout is keyed on `(hover: none) and (pointer: coarse)`, which a
`has_touch` context reports at any width.

The mock HLS fixtures are 12 s long. Seek assertions therefore pause the
video and place `currentTime` explicitly, so the result does not depend on
playback speed, and the player never reaches `ended` (which would auto-advance
to the next episode) in the middle of a test.

Run:  node tests/e2e/serve.mjs --build
      python -m pytest tests/e2e/test_player_controls.py -v
Screenshots of every viewport land in tests/e2e/shots/ (gitignored).
"""

import os

import pytest
from playwright.sync_api import sync_playwright

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:4020")
PASSWORD = os.environ.get("E2E_PASSWORD", "111111")
TITLE = "%E6%B5%8B%E8%AF%95%E5%BD%B1%E7%89%87 Test Movie"
YEAR = "2024"
PLAY_URL = f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}"
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")

BACK_LABEL = "后退 10 秒"
FORWARD_LABEL = "快进 10 秒"
# Must stay above the player's SEEK_CHAIN_MS (700) so separate gestures in a
# test never chain into each other.
CHAIN_GAP_MS = 900

# name -> (viewport, touch). Widths straddle the player's 768 px compact
# breakpoint and the play page's 1024 px desktop layout.
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
TOUCH_VIEWPORTS = [k for k, (_, touch) in VIEWPORTS.items() if touch]
MOUSE_VIEWPORTS = [k for k, (_, touch) in VIEWPORTS.items() if not touch]


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=True,
            # See tests/e2e/README.md: optional preinstalled Chromium.
            executable_path=os.environ.get("E2E_CHROMIUM") or None,
            args=["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
        )
        yield b
        b.close()


def _open(browser, name):
    viewport, touch = VIEWPORTS[name]
    ctx = browser.new_context(
        viewport=viewport,
        has_touch=touch,
        is_mobile=touch and viewport["width"] < 1024,
    )
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{BASE}/login", wait_until="domcontentloaded")
    page.evaluate(
        """async (pw) => {
            await fetch('/api/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ password: pw }),
            });
            localStorage.removeItem('moontv_play_records');
            localStorage.setItem('enablePreferBestSource', 'false');
        }""",
        PASSWORD,
    )
    page.goto(PLAY_URL, wait_until="domcontentloaded")
    # Ready = a decoded frame and the player's own loading card gone.
    page.wait_for_function(
        """() => {
            const v = document.querySelector('video');
            return v && v.readyState >= 2 && v.duration > 0;
        }""",
        timeout=30000,
    )
    # Wait on play / pause rather than the seek buttons, so the tests that
    # guard unchanged behaviour (mouse, keyboard, middle double tap) also run
    # against a build without them.
    page.wait_for_selector(
        "button[aria-label='播放'], button[aria-label='暂停']", timeout=10000
    )
    page.wait_for_function(
        "() => !document.body.innerText.includes('正在加载视频')", timeout=15000
    )
    return ctx, page, errors


def _park(page, t):
    """Pause the video at `t` seconds and wait until the seek has landed."""
    page.evaluate(
        """(t) => new Promise((resolve) => {
            const v = document.querySelector('video');
            v.pause();
            if (Math.abs(v.currentTime - t) < 0.05) return resolve();
            v.addEventListener('seeked', () => resolve(), { once: true });
            v.currentTime = t;
        })""",
        t,
    )


def _state(page):
    return page.evaluate(
        """() => {
            const v = document.querySelector('video');
            return { t: v.currentTime, d: v.duration, paused: v.paused };
        }"""
    )


def _surface_box(page):
    """Bounding box of the player's tap surface (the full-size click layer)."""
    box = page.evaluate(
        """() => {
            const v = document.querySelector('video');
            const r = v.getBoundingClientRect();
            return { x: r.left, y: r.top, width: r.width, height: r.height };
        }"""
    )
    assert box["width"] > 0 and box["height"] > 0
    return box


def _point(box, frac_x, frac_y=0.4):
    # 40 % down keeps clear of the control bar at the bottom and the title /
    # notice at the top.
    return box["x"] + box["width"] * frac_x, box["y"] + box["height"] * frac_y


def _tap(page, frac_x, times=2, gap_ms=120, frac_y=0.4):
    box = _surface_box(page)
    x, y = _point(box, frac_x, frac_y)
    for i in range(times):
        if i:
            page.wait_for_timeout(gap_ms)
        page.touchscreen.tap(x, y)


def _wait_time_near(page, expected, tol=0.6, timeout=5000):
    page.wait_for_function(
        """([e, tol]) => {
            const v = document.querySelector('video');
            return v && Math.abs(v.currentTime - e) <= tol;
        }""",
        arg=[expected, tol],
        timeout=timeout,
    )


def _shot(page, name, settle_ms=0):
    if settle_ms:
        # Let the ripple's 180 ms pop-in finish so the shot shows it as users do.
        page.wait_for_timeout(settle_ms)
    os.makedirs(SHOTS, exist_ok=True)
    page.screenshot(path=os.path.join(SHOTS, f"player-controls-{name}.png"))


# ---------------------------------------------------------------------------
# Control-bar buttons: every viewport
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", list(VIEWPORTS))
def test_buttons_seek_ten_seconds(browser, name):
    ctx, page, errors = _open(browser, name)
    try:
        # Old episode buttons are gone from the player.
        assert page.locator("button[aria-label='上一集']").count() == 0
        assert page.locator("button[aria-label='下一集']").count() == 0

        back = page.locator(f"button[aria-label='{BACK_LABEL}']")
        fwd = page.locator(f"button[aria-label='{FORWARD_LABEL}']")
        assert back.count() == 1 and fwd.count() == 1

        # Order in the bar: back, play/pause, forward.
        xs = page.evaluate(
            """([b, f]) => {
                const bb = document.querySelector(`button[aria-label='${b}']`);
                const fb = document.querySelector(`button[aria-label='${f}']`);
                const pb = bb.nextElementSibling;
                return [bb, pb, fb].map((el) => el.getBoundingClientRect().left);
            }""",
            [BACK_LABEL, FORWARD_LABEL],
        )
        assert xs[0] < xs[1] < xs[2], xs

        # The "10" glyph is part of the icon, and the hit target is at least
        # 36 px (h-9) so it stays tappable on the smallest phone.
        assert fwd.inner_text().strip() == "10"
        box = fwd.bounding_box()
        assert box["width"] >= 36 and box["height"] >= 36, box

        _shot(page, f"{name}-bar")

        touch = VIEWPORTS[name][1]

        def press(btn):
            btn.tap() if touch else btn.click()

        _park(page, 1)
        press(fwd)
        _wait_time_near(page, 11)
        press(back)
        _wait_time_near(page, 1)

        # Clamped at both ends.
        press(back)
        _wait_time_near(page, 0, tol=0.05)
        _park(page, 6)
        press(fwd)
        s = _state(page)
        _wait_time_near(page, s["d"] - 0.1, tol=0.15)

        # Seeking never changes the episode or the paused state.
        assert "第 1 集" in page.inner_text("body")
        assert _state(page)["paused"] is True
        assert not errors, errors
    finally:
        ctx.close()


# ---------------------------------------------------------------------------
# Layout: centred on touch screens, in the bar with a mouse
# ---------------------------------------------------------------------------

TRANSPORT_BOXES = """([b, f]) => {
    const v = document.querySelector('video').getBoundingClientRect();
    const box = (el) => {
        const r = el.getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width };
    };
    const bb = document.querySelector(`button[aria-label='${b}']`);
    const fb = document.querySelector(`button[aria-label='${f}']`);
    return {
        video: { left: v.left, top: v.top, w: v.width, h: v.height },
        back: box(bb), play: box(bb.nextElementSibling), fwd: box(fb),
    };
}"""


@pytest.mark.parametrize("name", list(VIEWPORTS))
def test_transport_buttons_placement(browser, name):
    ctx, page, errors = _open(browser, name)
    try:
        _park(page, 2)
        m = page.evaluate(TRANSPORT_BOXES, [BACK_LABEL, FORWARD_LABEL])
        v, play = m["video"], m["play"]
        rel_x = (play["cx"] - v["left"]) / v["w"]
        rel_y = (play["cy"] - v["top"]) / v["h"]
        if VIEWPORTS[name][1]:
            # Centred over the video, symmetric, and bigger than the bar size.
            assert abs(rel_x - 0.5) < 0.02, rel_x
            assert abs(rel_y - 0.5) < 0.02, rel_y
            left_gap = play["cx"] - m["back"]["cx"]
            right_gap = m["fwd"]["cx"] - play["cx"]
            assert abs(left_gap - right_gap) < 1.5, (left_gap, right_gap)
            assert play["w"] >= 60, play
        else:
            # Mouse: unchanged, at the left end of the bottom bar.
            assert rel_x < 0.25, rel_x
            assert rel_y > 0.75, rel_y
        assert not errors, errors
    finally:
        ctx.close()


@pytest.mark.parametrize("name", list(VIEWPORTS))
def test_whole_player_fits_on_screen(browser, name):
    """Regression: on a landscape phone the 16:9 player was taller than the
    screen, pushing the bottom bar (timeline, settings, fullscreen) off it."""
    ctx, page, errors = _open(browser, name)
    try:
        # The player plus whatever stays on screen over the page (the sticky
        # top nav from 768 px up, the fixed bottom tab bar below it) must fit
        # the screen, or part of the player is always covered.
        m = page.evaluate(
            """() => {
                const pinned = [...document.querySelectorAll('body *')].filter((el) => {
                    const cs = getComputedStyle(el);
                    if (cs.position !== 'sticky' && cs.position !== 'fixed') return false;
                    const r = el.getBoundingClientRect();
                    // full-width bars only: not toasts, menus or the player's own UI
                    return r.height > 0 && r.width >= innerWidth - 1 && cs.display !== 'none'
                        && cs.visibility !== 'hidden';
                });
                return {
                    player: document.querySelector('video').parentElement
                        .getBoundingClientRect().height,
                    pinned: pinned.reduce((h, el) => h + el.getBoundingClientRect().height, 0),
                    names: pinned.map((el) => el.tagName + '.' + el.className.slice(0, 40)),
                };
            }"""
        )
        assert m["player"] + m["pinned"] <= VIEWPORTS[name][0]["height"] + 0.5, m
        fs = _player(page).get_by_role("button", name="全屏", exact=True)
        fs.scroll_into_view_if_needed()
        assert fs.is_visible()
        assert not errors, errors
    finally:
        ctx.close()


@pytest.mark.parametrize("name", ["phone", "tablet-landscape"])
def test_centre_controls_hide_with_the_controls(browser, name):
    """Hidden centre buttons must not swallow taps meant for the video."""
    ctx, page, errors = _open(browser, name)
    try:
        _park(page, 0.2)
        page.evaluate("document.querySelector('video').play()")
        # Controls auto-hide 2.6 s after playback starts.
        page.wait_for_function(
            f"""() => {{
                const b = document.querySelector("button[aria-label='{FORWARD_LABEL}']");
                return getComputedStyle(b.parentElement.parentElement).opacity === '0'
                    && getComputedStyle(b).pointerEvents === 'none';
            }}""",
            timeout=6000,
        )
        _shot(page, f"{name}-hidden")
        # A single tap where the play button was only brings the controls back.
        _tap(page, 0.5, times=1, frac_y=0.5)
        page.wait_for_function(
            f"""() => {{
                const b = document.querySelector("button[aria-label='{FORWARD_LABEL}']");
                return getComputedStyle(b).pointerEvents === 'auto';
            }}""",
            timeout=2000,
        )
        assert _state(page)["paused"] is False
        # Now visible, the centre play button pauses.
        page.locator("button[aria-label='暂停']").tap()
        page.wait_for_function(
            "() => document.querySelector('video').paused", timeout=3000
        )
        assert not errors, errors
    finally:
        ctx.close()


@pytest.mark.parametrize("name", ["phone", "tablet"])
def test_tap_on_hidden_bar_button_does_not_press_it(browser, name):
    """Regression: the click a browser synthesises after a tap used to land on
    the control that the tap itself had just revealed (e.g. the settings
    button), so revealing the controls also opened the settings menu."""
    ctx, page, errors = _open(browser, name)
    try:
        settings_btn = _player(page).get_by_role("button", name="设置", exact=True)
        box = settings_btn.bounding_box()
        _park(page, 0.2)
        page.evaluate("document.querySelector('video').play()")
        # Wait on the settings button itself (not the newer seek buttons), so
        # this also runs against builds without them: it reproduces there.
        page.wait_for_function(
            """() => getComputedStyle(document.querySelector(
                "button[aria-label='设置']")).pointerEvents === 'none'""",
            timeout=6000,
        )
        page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_timeout(400)
        assert page.get_by_role("menu").count() == 0
        assert _state(page)["paused"] is False
        assert settings_btn.is_visible()
        assert not errors, errors
    finally:
        ctx.close()


# ---------------------------------------------------------------------------
# Touch: double tap left / right / middle
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", TOUCH_VIEWPORTS)
def test_double_tap_sides_seek_ten_seconds(browser, name):
    ctx, page, errors = _open(browser, name)
    try:
        _park(page, 5)
        _tap(page, 0.85)
        _wait_time_near(page, 11.9, tol=0.15)  # 5 + 10, clamped to d - 0.1
        # The YouTube-style ripple sits on the right half and says how far.
        ripple = page.locator("text=10 秒").first
        ripple.wait_for(timeout=2000)
        rb = ripple.bounding_box()
        vb = _surface_box(page)
        assert rb["x"] > vb["x"] + vb["width"] / 2, (rb, vb)
        # The centre buttons step aside while the ripple shows; with the video
        # paused the controls stay up and would otherwise sit on top of it.
        assert page.evaluate(
            f"""() => getComputedStyle(document.querySelector(
                "button[aria-label='{FORWARD_LABEL}']")).pointerEvents"""
        ) == "none"
        _shot(page, f"{name}-ripple-forward", settle_ms=250)

        page.wait_for_timeout(CHAIN_GAP_MS)
        _park(page, 8)
        _tap(page, 0.12)
        _wait_time_near(page, 0, tol=0.05)  # 8 - 10, clamped to 0
        ripple = page.locator("text=10 秒").first
        ripple.wait_for(timeout=2000)
        rb = ripple.bounding_box()
        assert rb["x"] + rb["width"] < vb["x"] + vb["width"] / 2, (rb, vb)
        _shot(page, f"{name}-ripple-back", settle_ms=250)

        assert _state(page)["paused"] is True, "a side double tap must not toggle play"
        assert "第 1 集" in page.inner_text("body")
        assert not errors, errors
    finally:
        ctx.close()


@pytest.mark.parametrize("name", ["phone", "tablet"])
def test_double_tap_seeks_while_playing(browser, name):
    """The realistic case: the video is playing and the controls are hidden."""
    ctx, page, errors = _open(browser, name)
    try:
        _park(page, 0.5)
        page.evaluate("document.querySelector('video').play()")
        page.wait_for_function(
            "() => !document.querySelector('video').paused", timeout=5000
        )
        t0 = _state(page)["t"]
        _tap(page, 0.85)
        page.wait_for_function(
            "(t0) => document.querySelector('video').currentTime >= t0 + 9.5",
            arg=t0,
            timeout=3000,
        )
        assert not errors, errors
    finally:
        ctx.close()


@pytest.mark.parametrize("name", ["phone-small", "phone", "tablet"])
def test_consecutive_taps_accumulate(browser, name):
    """After a double tap, every further tap on the same side adds 10 s."""
    ctx, page, errors = _open(browser, name)
    try:
        # Media is 12 s: start near the end and go backwards so 3 steps fit.
        _park(page, 11)
        # double tap (-10) then one more tap (-10, chained): 11 → 1 → 0.
        _tap(page, 0.12, times=3, gap_ms=150)
        _wait_time_near(page, 0, tol=0.05)
        page.locator("text=20 秒").first.wait_for(timeout=2000)
        _shot(page, f"{name}-ripple-chain", settle_ms=250)

        # The chain expires; a single tap afterwards is just a tap (no seek).
        page.wait_for_timeout(CHAIN_GAP_MS)
        _park(page, 6)
        _tap(page, 0.12, times=1)
        page.wait_for_timeout(500)
        assert abs(_state(page)["t"] - 6) < 0.05
        assert not errors, errors
    finally:
        ctx.close()


@pytest.mark.parametrize("name", ["phone", "phone-landscape", "tablet"])
def test_double_tap_middle_toggles_play(browser, name):
    ctx, page, errors = _open(browser, name)
    try:
        _park(page, 2)
        assert _state(page)["paused"] is True
        # 15 % down: the middle third of the surface, clear of the centred
        # play button (which is a button, not the tap surface).
        _tap(page, 0.5, frac_y=0.15)
        page.wait_for_function(
            "() => !document.querySelector('video').paused", timeout=3000
        )
        # No seek happened on a middle double tap.
        assert _state(page)["t"] < 4
        assert page.locator("text=10 秒").count() == 0
        page.wait_for_timeout(CHAIN_GAP_MS)
        _tap(page, 0.5, frac_y=0.15)
        page.wait_for_function(
            "() => document.querySelector('video').paused", timeout=3000
        )
        assert not errors, errors
    finally:
        ctx.close()


@pytest.mark.parametrize("name", ["phone", "tablet"])
def test_single_tap_only_toggles_controls(browser, name):
    ctx, page, errors = _open(browser, name)
    try:
        _park(page, 3)
        page.evaluate("document.querySelector('video').play()")
        page.wait_for_function(
            "() => !document.querySelector('video').paused", timeout=5000
        )
        page.wait_for_timeout(300)
        t0 = _state(page)["t"]
        _tap(page, 0.85, times=1)
        page.wait_for_timeout(500)
        s = _state(page)
        assert s["paused"] is False
        # Playback advanced naturally, but no 10 s jump.
        assert s["t"] < t0 + 3, (t0, s)
        assert page.locator("text=10 秒").count() == 0
        assert not errors, errors
    finally:
        ctx.close()


# ---------------------------------------------------------------------------
# Mouse: unchanged behaviour
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", MOUSE_VIEWPORTS)
def test_mouse_double_click_does_not_seek(browser, name):
    """Desktop keeps click = play/pause, double-click = fullscreen."""
    ctx, page, errors = _open(browser, name)
    try:
        _park(page, 5)
        box = _surface_box(page)
        x, y = _point(box, 0.85)
        page.mouse.click(x, y)
        page.wait_for_function(
            "() => !document.querySelector('video').paused", timeout=3000
        )
        page.mouse.click(x, y)
        page.wait_for_function(
            "() => document.querySelector('video').paused", timeout=3000
        )
        t = _state(page)["t"]
        page.wait_for_timeout(CHAIN_GAP_MS)
        page.mouse.dblclick(x, y)
        page.wait_for_timeout(600)
        assert page.locator("text=10 秒").count() == 0
        assert abs(_state(page)["t"] - t) < 1.5, "a double-click must not seek"
        page.wait_for_function("() => !!document.fullscreenElement", timeout=3000)
        assert not errors, errors
    finally:
        ctx.close()


# ---------------------------------------------------------------------------
# Episode navigation still works without the buttons
# ---------------------------------------------------------------------------


def test_alt_arrows_still_switch_episodes(browser):
    ctx, page, errors = _open(browser, "desktop")
    try:
        page.keyboard.press("Alt+ArrowRight")
        page.wait_for_function(
            "() => document.body.innerText.includes('第 2 集')", timeout=10000
        )
        page.wait_for_function(
            """() => {
                const v = document.querySelector('video');
                return v && v.readyState >= 2;
            }""",
            timeout=15000,
        )
        page.keyboard.press("Alt+ArrowLeft")
        page.wait_for_function(
            "() => document.body.innerText.includes('第 1 集')", timeout=10000
        )
        assert page.locator("video").count() == 1
        assert not errors, errors
    finally:
        ctx.close()


def test_arrow_keys_still_seek(browser):
    ctx, page, errors = _open(browser, "desktop")
    try:
        _park(page, 1)
        page.keyboard.press("ArrowRight")
        _wait_time_near(page, 11)
        page.keyboard.press("ArrowLeft")
        _wait_time_near(page, 1)
        assert not errors, errors
    finally:
        ctx.close()


# ---------------------------------------------------------------------------
# Settings menu: two levels, always fully reachable inside the player
# ---------------------------------------------------------------------------
#
# Level 1 holds the everyday switches (去广告, 弹幕) and one row per category
# (片头片尾 ›, 弹幕设置 ›) with a one-word summary; each category opens a level-2
# page with a back header. The player is overflow-hidden and only ~220 px tall
# on a portrait phone, so the menu is height-capped to the space above its
# button inside the player and scrolls within itself when that is not enough.

LEVEL1 = ["去广告", "弹幕", "片头片尾", "弹幕设置"]

MENU_GEOMETRY = """() => {
    const menu = document.querySelector("[role='menu']");
    const player = document.querySelector('video').parentElement;
    const m = menu.getBoundingClientRect();
    const p = player.getBoundingClientRect();
    return {
        menuTop: m.top, menuBottom: m.bottom, playerTop: p.top,
        playerBottom: p.bottom, scrollH: menu.scrollHeight, clientH: menu.clientHeight,
    };
}"""


def _player(page):
    return page.locator("video").locator("xpath=..")


def _press(page, name, locator):
    locator.tap() if VIEWPORTS[name][1] else locator.click()


def _open_settings(page, name):
    _press(page, name, _player(page).get_by_role("button", name="设置", exact=True))
    menu = page.get_by_role("menu")
    menu.wait_for(timeout=3000)
    return menu


def _row_labels(menu):
    """Row labels without their trailing hint / switch."""
    return menu.evaluate(
        """(m) => [...m.querySelectorAll("[role^='menuitem']")]
            .map((r) => r.querySelector('span').textContent.trim())"""
    )


def _assert_menu_inside_player(page):
    g = page.evaluate(MENU_GEOMETRY)
    assert g["menuTop"] >= g["playerTop"] - 0.5, g
    assert g["menuBottom"] <= g["playerBottom"] + 0.5, g
    return g


def _assert_rows_reachable(page, menu):
    """Every row can be brought into view inside the player by scrolling."""
    rows = menu.locator("[role^='menuitem']")
    for i in range(rows.count()):
        row = rows.nth(i)
        row.scroll_into_view_if_needed()
        r = row.bounding_box()
        g = page.evaluate(MENU_GEOMETRY)
        assert r["y"] >= g["playerTop"] - 0.5, (i, r, g)
        assert r["y"] + r["height"] <= g["playerBottom"] + 0.5, (i, r, g)


@pytest.mark.parametrize("name", list(VIEWPORTS))
def test_settings_menu_has_two_levels(browser, name):
    ctx, page, errors = _open(browser, name)
    try:
        _park(page, 3)
        menu = _open_settings(page, name)
        assert _row_labels(menu) == LEVEL1
        if VIEWPORTS[name][1]:
            # The centre buttons step aside while a menu is open; on a short
            # phone they would otherwise cover (and steal taps from) its rows.
            assert page.evaluate(
                f"""() => getComputedStyle(document.querySelector(
                    "button[aria-label='{FORWARD_LABEL}']")).pointerEvents"""
            ) == "none"
        _assert_menu_inside_player(page)
        _assert_rows_reachable(page, menu)
        _shot(page, f"{name}-settings", settle_ms=250)

        # Level-1 switches flip in place and keep the menu open.
        danmaku = menu.get_by_role("menuitemcheckbox", name="弹幕", exact=True)
        before = danmaku.get_attribute("aria-checked")
        _press(page, name, danmaku)
        after = danmaku.get_attribute("aria-checked")
        assert after != before
        assert menu.is_visible()

        # Category: 片头片尾 → level 2 with a back header.
        skip_row = menu.get_by_role("menuitem", name="片头片尾")
        assert skip_row.get_attribute("aria-haspopup") == "menu"
        assert "关" in skip_row.inner_text()
        _press(page, name, skip_row)
        assert _row_labels(menu) == ["跳过片头片尾", "设置片头", "设置片尾"]
        back = menu.get_by_role("button", name="返回 · 片头片尾")
        assert back.is_visible()
        _press(page, name, menu.get_by_role("menuitemcheckbox", name="跳过片头片尾"))
        # Turning skipping on adds the 删除跳过配置 row; still all reachable.
        menu.get_by_role("menuitem", name="删除跳过配置").wait_for(timeout=3000)
        _assert_menu_inside_player(page)
        _assert_rows_reachable(page, menu)
        _shot(page, f"{name}-settings-skip", settle_ms=250)
        _press(page, name, back)
        assert _row_labels(menu) == LEVEL1
        assert "开" in menu.get_by_role("menuitem", name="片头片尾").inner_text()

        # Category: 弹幕设置 → the same switch as level 1, plus the source.
        _press(page, name, menu.get_by_role("menuitem", name="弹幕设置"))
        assert _row_labels(menu) == ["显示弹幕", "弹幕源"]
        show = menu.get_by_role("menuitemcheckbox", name="显示弹幕")
        assert show.get_attribute("aria-checked") == after
        _press(page, name, menu.get_by_role("button", name="返回 · 弹幕设置"))

        # Closing and reopening always starts at level 1.
        _press(page, name, menu.get_by_role("menuitem", name="弹幕设置"))
        _press(page, name, _player(page).get_by_role("button", name="设置", exact=True))
        menu.wait_for(state="detached", timeout=3000)
        menu = _open_settings(page, name)
        assert _row_labels(menu) == LEVEL1
        assert not errors, errors
    finally:
        ctx.close()


@pytest.mark.parametrize("name", ["phone-small", "phone"])
def test_settings_menu_scrolls_when_the_player_is_short(browser, name):
    """Portrait phones: the cap is the player, not the viewport."""
    ctx, page, errors = _open(browser, name)
    try:
        _park(page, 3)
        menu = _open_settings(page, name)
        _press(page, name, menu.get_by_role("menuitem", name="片头片尾"))
        _press(page, name, menu.get_by_role("menuitemcheckbox", name="跳过片头片尾"))
        menu.get_by_role("menuitem", name="删除跳过配置").wait_for(timeout=3000)
        g = _assert_menu_inside_player(page)
        player_h = g["playerBottom"] - g["playerTop"]
        assert g["clientH"] < player_h, g
        # Scrolling the menu does not scroll the page or close the menu.
        y0 = page.evaluate("scrollY")
        menu.evaluate("(m) => { m.scrollTop = m.scrollHeight; }")
        last = menu.get_by_role("menuitem", name="删除跳过配置")
        r = last.bounding_box()
        assert r["y"] + r["height"] <= g["playerBottom"] + 0.5
        assert page.evaluate("scrollY") == y0
        assert menu.is_visible()
        _press(page, name, last)
        menu.get_by_role("menuitem", name="删除跳过配置").wait_for(
            state="detached", timeout=3000
        )
        assert not errors, errors
    finally:
        ctx.close()
