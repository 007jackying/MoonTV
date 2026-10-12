#!/usr/bin/env python
"""
Browser e2e for the play page details block: description and 豆瓣 button.

Relies on two mock-CMS fixtures (tests/e2e/mock-cms.mjs):
  fast  long two-paragraph synopsis in <p> tags, indented / padded with
        `&nbsp;` and `&amp;nbsp;`, Douban id 1292052
  mid   one-line synopsis, no Douban id

Covered:
  format    the description has no leftover HTML entities / tags and no
            trailing padding (server-side cleanHtmlTags)
  clamp     a long description is clamped to 4 lines with a 展开全文 toggle,
            on phone and desktop layouts
  nav       on a phone, the toggle can be scrolled clear of the fixed bottom
            nav and actually receives the tap
  toggle    展开全文 shows the whole text, 收起 clamps it again and scrolls the
            paragraph back into view if its top had scrolled off-screen
  short     a short description gets no toggle
  rating    the 豆瓣 button shows the rating from /api/douban/subject
            ("豆瓣 7.5"); with no rating it stays a plain "豆瓣"
  api       /api/douban/subject rejects a bad id with 400

The rating is mocked at the browser (page.route) because the harness has no
Douban access; the server route's parsing is unit-tested in
src/lib/__tests__/douban-rating.test.ts.

Boot the app first (any profile with `fast` and `mid`, i.e. the default):
    node tests/e2e/serve.mjs --build

Usage:
    python tests/e2e/test_play_details.py [--url http://127.0.0.1:4020]
        [--shots DIR]   save screenshots of each state to DIR

Requires playwright + chromium and the HLS fixtures (tests/e2e/make-media.sh;
CODEC=vp9 for Playwright's Chromium) — see tests/e2e/README.md.
"""

import argparse
import os
import sys
from urllib.parse import quote

from playwright.sync_api import sync_playwright

PASSWORD = os.environ.get("E2E_PASSWORD", "111111")
TITLE = "测试影片 Test Movie"
YEAR = "2024"
DOUBAN_ID = 1292052
RATING = "7.5"

# Text fragments from the `fast` fixture (mock-cms.mjs LONG_DESC).
LONG_DESC_START = "对这个世界充满瑰丽幻想"
PARA1_END = "总要近距离去感受它的甜蜜和粗粝……"
PARA2_START = "另一方面，天堂浬的过去"
LONG_DESC_END = "这是一部关于梦想、勇气与初心的医疗爱情剧。"

PLAY_TIMEOUT_MS = 60000

PHONE = dict(
    viewport={"width": 390, "height": 844},
    device_scale_factor=2,
    is_mobile=True,
    has_touch=True,
)
DESKTOP = dict(viewport={"width": 1440, "height": 900})

RESULTS = []


def ok(name, cond, detail=""):
    RESULTS.append((bool(cond), name, detail))
    mark = "✓" if cond else "✗"
    suffix = f" — {detail}" if detail else ""
    print(f"  {mark} {name}{suffix}", flush=True)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def login(page, base):
    page.goto(f"{base}/login", wait_until="domcontentloaded")
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


def dismiss_overlays(page, attempts=4):
    """Close the first-run announcement modal if it shows up (see
    test_av_filter.py for why this is retried)."""
    for _ in range(attempts):
        try:
            page.wait_for_selector("div[role='dialog']", state="attached", timeout=1500)
        except Exception:
            return
        dialog = page.locator("div[role='dialog']:visible")
        if not dialog.count():
            return
        try:
            dialog.first.locator("button").last.click(timeout=2000)
        except Exception:
            return
        page.wait_for_timeout(300)


def new_page(browser, base, profile, rating):
    """`rating`: str to mock /api/douban/subject with, None to answer
    "no rating", False to leave the real route alone."""
    ctx = browser.new_context(**profile)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    if rating is not False:
        page.route(
            "**/api/douban/subject?*",
            lambda r: r.fulfill(json={"rate": rating}),
        )
    login(page, base)
    return ctx, page, errors


def open_play(page, base, source):
    """Open the play page on `source`. Media is served for real (see
    make-media.sh): aborting it would trip the player's automatic failover
    and swap in another source's details mid-test."""
    page.goto(
        f"{base}/play?source={source}&id={source}-1"
        f"&title={quote(TITLE)}&year={YEAR}",
        wait_until="domcontentloaded",
    )
    dismiss_overlays(page)


def desc_metrics(page, needle):
    """Geometry of the description <p> and its toggle button."""
    p = page.locator(f"p:has-text('{needle}')").first
    p.wait_for(state="attached", timeout=PLAY_TIMEOUT_MS)
    return p.evaluate(
        """el => {
            const cs = getComputedStyle(el);
            const btn = el.parentElement.querySelector('button[aria-expanded]');
            return {
                text: el.innerText,
                clamp: cs.webkitLineClamp,
                lineHeight: parseFloat(cs.lineHeight),
                clientHeight: el.clientHeight,
                scrollHeight: el.scrollHeight,
                top: el.getBoundingClientRect().top,
                button: btn && {
                    text: btn.innerText.trim(),
                    expanded: btn.getAttribute('aria-expanded'),
                },
            };
        }"""
    )


def toggle_button(page, label):
    return page.locator(f"button[aria-expanded]:has-text('{label}')").first


def douban_link(page):
    return page.locator(f"a[href*='movie.douban.com/subject/{DOUBAN_ID}']:visible").first


# `html, body { height: 100%; overflow-x: hidden }` (globals.css) makes <body>
# the scroll container, so window.scrollTo() is a no-op. Scroll whichever
# element actually scrolls.
SCROLLER_JS = """() => [document.body, document.scrollingElement]
    .find(e => e && e.scrollHeight > e.clientHeight + 1) || document.body"""


def scroll_to_bottom(page):
    page.evaluate(f"(() => {{ const s = ({SCROLLER_JS})(); s.scrollTop = s.scrollHeight; }})()")
    page.wait_for_timeout(400)


def scroll_by(page, dy_js):
    page.evaluate(f"(() => {{ const s = ({SCROLLER_JS})(); s.scrollTop += {dy_js}; }})()")
    page.wait_for_timeout(300)


def shot(page, shots, name):
    if shots:
        page.screenshot(path=os.path.join(shots, f"{name}.png"))


# ---------------------------------------------------------------------------
# scenarios
# ---------------------------------------------------------------------------
def phone_long(browser, base, shots):
    print("\n[phone] long description + rating", flush=True)
    ctx, page, errors = new_page(browser, base, PHONE, RATING)
    open_play(page, base, "fast")

    m = desc_metrics(page, LONG_DESC_START)
    text = m["text"]
    ok("format: no HTML entities left", "&nbsp" not in text and "&amp;" not in text, repr(text[-40:]))
    ok("format: no HTML tags left", "<p>" not in text and "</p>" not in text)
    ok("format: trailing padding trimmed", text.endswith(LONG_DESC_END), repr(text[-20:]))
    ok(
        "format: paragraphs kept as one line break, indent trimmed",
        f"{PARA1_END}\n{PARA2_START}" in text,
        repr(text[text.find(PARA1_END):][:40]),
    )

    ok("clamp: 4-line clamp applied", m["clamp"] == "4", f"line-clamp={m['clamp']}")
    ok(
        "clamp: height is 4 lines",
        abs(m["clientHeight"] - 4 * m["lineHeight"]) <= 2,
        f"{m['clientHeight']}px vs 4×{m['lineHeight']}px",
    )
    ok("clamp: text overflows", m["scrollHeight"] > m["clientHeight"] + 1)
    ok(
        "clamp: 展开全文 toggle shown, collapsed",
        m["button"] and m["button"]["text"] == "展开全文" and m["button"]["expanded"] == "false",
        str(m["button"]),
    )

    link = douban_link(page)
    try:
        link.wait_for(timeout=10000)
        page.wait_for_function(
            "(sel) => document.querySelector(sel)?.innerText.includes('7.5')",
            arg=f"a[href*='subject/{DOUBAN_ID}']",
            timeout=10000,
        )
    except Exception:
        pass
    link_text = " ".join(link.inner_text().split()) if link.count() else ""
    ok("rating: button reads 豆瓣 7.5", link_text == f"豆瓣 {RATING}", repr(link_text))
    ok(
        "rating: accessible name includes rating",
        (link.get_attribute("aria-label") or "") == f"豆瓣 评分 {RATING}",
        repr(link.get_attribute("aria-label")),
    )
    shot(page, shots, "phone-1-top")

    # Scroll to the very bottom: the toggle must sit above the fixed nav and
    # be the element that actually receives a tap at its centre.
    scroll_to_bottom(page)
    btn = toggle_button(page, "展开全文")
    hit = btn.evaluate(
        """b => {
            const r = b.getBoundingClientRect();
            const nav = document.querySelector('nav.fixed');
            const navTop = nav ? nav.getBoundingClientRect().top : innerHeight;
            const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { bottom: r.bottom, navTop, hit: b === at || b.contains(at) };
        }"""
    )
    ok("nav: toggle clears the bottom nav", hit["bottom"] <= hit["navTop"], str(hit))
    ok("nav: toggle receives the tap", hit["hit"], str(hit))
    shot(page, shots, "phone-2-collapsed-bottom")

    btn.tap()
    page.wait_for_timeout(300)
    m = desc_metrics(page, LONG_DESC_START)
    ok("toggle: clamp removed", m["clamp"] in ("none", ""), f"line-clamp={m['clamp']}")
    ok("toggle: full text visible", m["scrollHeight"] <= m["clientHeight"] + 1)
    ok(
        "toggle: button now 收起, expanded",
        m["button"] and m["button"]["text"] == "收起" and m["button"]["expanded"] == "true",
        str(m["button"]),
    )
    scroll_to_bottom(page)
    shot(page, shots, "phone-3-expanded-bottom")

    # Scroll so the paragraph top is off-screen, then collapse. On an 844px
    # phone the whole expanded fixture fits on screen, so shrink the viewport
    # (small phone / long synopsis) to make the top scroll off.
    page.set_viewport_size({"width": 390, "height": 480})
    page.wait_for_timeout(300)
    scroll_by(
        page,
        f"[...document.querySelectorAll('p')]"
        f".find(e => e.innerText.startsWith('{LONG_DESC_START}'))"
        f".getBoundingClientRect().top + 120",
    )
    before = desc_metrics(page, LONG_DESC_START)["top"]
    toggle_button(page, "收起").tap()
    page.wait_for_timeout(1000)  # smooth scroll
    m = desc_metrics(page, LONG_DESC_START)
    ok("toggle: 收起 clamps again", m["clamp"] == "4" and m["button"]["text"] == "展开全文", str(m["button"]))
    ok(
        "toggle: paragraph scrolled back into view",
        before < 0 and m["top"] >= -1,
        f"top before={before:.0f}px after={m['top']:.0f}px",
    )
    shot(page, shots, "phone-4-recollapsed")
    ok("still on the fast source (no failover)", "source=fast" in page.url, page.url)

    ok("no uncaught page errors", not errors, "; ".join(errors[:3]))
    ctx.close()


def phone_short(browser, base, shots):
    print("\n[phone] short description, no Douban id", flush=True)
    ctx, page, errors = new_page(browser, base, PHONE, RATING)
    open_play(page, base, "mid")
    m = desc_metrics(page, "短简介")
    ok("format: short text cleaned", m["text"] == "短简介 。", repr(m["text"]))
    ok("short: no toggle", m["button"] is None, str(m["button"]))
    page.wait_for_timeout(500)
    ok("short: no 豆瓣 button without a Douban id", page.locator("a[href*='movie.douban.com']:visible").count() == 0)
    shot(page, shots, "phone-5-short")
    ok("no uncaught page errors", not errors, "; ".join(errors[:3]))
    ctx.close()


def phone_no_rating(browser, base, shots):
    print("\n[phone] Douban has no rating", flush=True)
    ctx, page, errors = new_page(browser, base, PHONE, None)
    open_play(page, base, "fast")
    link = douban_link(page)
    link.wait_for(timeout=PLAY_TIMEOUT_MS)
    page.wait_for_timeout(1000)
    text = " ".join(link.inner_text().split())
    ok("rating: unrated stays plain 豆瓣", text == "豆瓣", repr(text))
    ok("rating: no aria-label override", link.get_attribute("aria-label") is None)
    ok("no uncaught page errors", not errors, "; ".join(errors[:3]))
    ctx.close()


def phone_rating_unreachable(browser, base, shots):
    print("\n[phone] real /api/douban/subject (Douban unreachable from the harness)", flush=True)
    ctx, page, errors = new_page(browser, base, PHONE, False)
    statuses = []
    page.on(
        "response",
        lambda r: statuses.append(r.status) if "/api/douban/subject" in r.url else None,
    )
    open_play(page, base, "fast")
    link = douban_link(page)
    link.wait_for(timeout=PLAY_TIMEOUT_MS)
    # The server gives up after its 10 s upstream timeout at worst.
    for _ in range(30):
        if statuses:
            break
        page.wait_for_timeout(500)
    text = " ".join(link.inner_text().split())
    ok("rating: route answers 200 even when Douban is unreachable", statuses == [200], str(statuses))
    ok("rating: failure degrades to plain 豆瓣", text == "豆瓣", repr(text))
    ok("no uncaught page errors", not errors, "; ".join(errors[:3]))
    ctx.close()


def desktop_long(browser, base, shots):
    print("\n[desktop] long description + rating", flush=True)
    ctx, page, errors = new_page(browser, base, DESKTOP, RATING)
    open_play(page, base, "fast")
    m = desc_metrics(page, LONG_DESC_START)
    ok("format: desktop text cleaned", m["text"].endswith(LONG_DESC_END), repr(m["text"][-20:]))
    ok("clamp: desktop clamped with toggle", m["clamp"] == "4" and m["button"] and m["button"]["text"] == "展开全文", str(m))
    link = douban_link(page)
    link.wait_for(timeout=10000)
    page.wait_for_timeout(800)
    text = " ".join(link.inner_text().split())
    ok("rating: desktop button reads 豆瓣 7.5", text == f"豆瓣 {RATING}", repr(text))
    shot(page, shots, "desktop-1-collapsed")
    toggle_button(page, "展开全文").click()
    page.wait_for_timeout(300)
    m = desc_metrics(page, LONG_DESC_START)
    ok("toggle: desktop expands", m["scrollHeight"] <= m["clientHeight"] + 1 and m["button"]["text"] == "收起")
    shot(page, shots, "desktop-2-expanded")
    ok("no uncaught page errors", not errors, "; ".join(errors[:3]))
    ctx.close()


def api_checks(browser, base):
    print("\n[api] /api/douban/subject", flush=True)
    ctx = browser.new_context()
    page = ctx.new_page()
    login(page, base)
    for bad in ("abc", "0", "-3", "1.5"):
        r = page.request.get(f"{base}/api/douban/subject?id={bad}")
        ok(f"api: id={bad} → 400", r.status == 400, str(r.status))
    ctx.close()


def run(pw, base, shots):
    browser = pw.chromium.launch(
        headless=True,
        executable_path=os.environ.get("E2E_CHROMIUM") or None,
    )
    try:
        phone_long(browser, base, shots)
        phone_short(browser, base, shots)
        phone_no_rating(browser, base, shots)
        phone_rating_unreachable(browser, base, shots)
        desktop_long(browser, base, shots)
        api_checks(browser, base)
    finally:
        browser.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:4020")
    ap.add_argument("--shots", default="")
    a = ap.parse_args()
    if a.shots:
        os.makedirs(a.shots, exist_ok=True)

    with sync_playwright() as pw:
        run(pw, a.url, a.shots)

    passed = sum(1 for good, _, _ in RESULTS if good)
    failed = len(RESULTS) - passed
    print(f"\n{passed} passed, {failed} failed", flush=True)
    if failed:
        print("\nFailures:")
        for good, name, detail in RESULTS:
            if not good:
                print(f"  - {name}" + (f" — {detail}" if detail else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
