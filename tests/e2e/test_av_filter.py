#!/usr/bin/env python
"""
Browser-level e2e for the global AV-source filter.

Companion to test_av_filter.mjs (which covers the API surface). This file covers
what only a real browser can observe: that the *user preference* stored in
localStorage actually reaches the server, and that the adult sources disappear
from every surface that lists or uses them.

Covered:
  settings   the 过滤 AV 资源 toggle exists, defaults to on, is not written to
             localStorage until touched, persists when toggled, broadcasts to
             already-mounted components, and is restored by 重置
  search     /search returns adult sources when the toggle is off and none when
             it is on — asserted both on the rendered cards and on the actual
             /api/search payloads the page issued
  selector   the source-selector popup lists adult sources when off, none when on
  play       the play page source panel lists adult sources when off, none when on
  roundtrip  a `savedSources` list that still names an adult source is honoured
             while the toggle is off, and is pruned from localStorage once the
             toggle goes back on
  reset      重置 restores the default

Boot the app with adult sources first:
    node tests/e2e/serve.mjs --profile=avfilter

Usage:
    python tests/e2e/test_av_filter.py [--url http://127.0.0.1:4020]

Requires playwright + chromium (`playwright install chromium`).
See run-av-filter.sh for a one-command wrapper.
"""

import argparse
import json
import os
import sys
from urllib.parse import parse_qs, quote, urlparse

from playwright.sync_api import sync_playwright

PASSWORD = os.environ.get("E2E_PASSWORD", "111111")

# The mock CMS serves one title/year for every source (mock-cms.mjs).
TITLE = "测试影片 Test Movie"
YEAR = "2024"

# Mirrors the `avfilter` profile in tests/e2e/serve.mjs. Keep in sync.
ADULT_SOURCE_NAMES = {"AV-e2e-first", "e2e-flagged"}
NORMAL_SOURCE_NAMES = {"E2E-fast", "E2E-mid"}

FILTER_KEY = "filterAdultSources"
SAVED_SOURCES_KEY = "savedSources"
TOGGLE_LABEL = "过滤 AV 资源"

# `next dev` wedges (spins at 100% CPU, stops answering) once the play page
# starts pulling HLS playlists/segments through the /api/m3u8 proxy. That is a
# dev-server quirk unrelated to this feature, and playback is not what we assert
# here, so the media requests are aborted.
MEDIA_GLOBS = ["**/api/m3u8**", "**/*.m3u8", "**/*.ts"]

# Console noise caused by this test aborting those requests: the browser logs a
# generic "Failed to load resource" per aborted request, and hls.js logs a fatal
# manifestLoadError once it notices. Both are this test's own doing — playback is
# out of scope here — so they are not treated as app errors. Everything else
# (React errors, hydration warnings, failed app requests) still is.
EXPECTED_CONSOLE_NOISE = (
    "Failed to load resource",
    "HLS错误",
    "manifestLoadError",
    "manifestParsingError",
)

# How long to let the dev server compile + the streaming search settle.
SETTLE_MS = 3000
SEARCH_TIMEOUT_MS = 60000
PLAY_TIMEOUT_MS = 60000

RESULTS = []


def ok(name, cond, detail=""):
    RESULTS.append((bool(cond), name, detail))
    mark = "✓" if cond else "✗"
    suffix = f" — {detail}" if detail else ""
    print(f"  {mark} {name}{suffix}", flush=True)


def is_adult(name):
    """Mirror of isAdultSource() in src/lib/adult-filter.ts."""
    if not name:
        return False
    n = name.strip()
    return len(n) > 2 and n[:2].upper() == "AV" and n[2] in " \t-_·:："


# ---------------------------------------------------------------------------
# page helpers
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


def seed_prefs(page):
    """Deterministic starting point.

    Non-stream + non-aggregate search makes /api/search return plain JSON and
    renders one card per result, so both the response payload and the card hrefs
    name every source individually. Without this the aggregate view would hide
    all but one source behind a single grouped card.
    """
    page.evaluate(
        """([filterKey, savedKey]) => {
            localStorage.removeItem(filterKey);
            localStorage.removeItem(savedKey);
            localStorage.removeItem('moontv_play_records');
            localStorage.removeItem('moontv_cache_default');
            localStorage.setItem('defaultStreamSearch', 'false');
            localStorage.setItem('defaultAggregateSearch', 'false');
            localStorage.setItem('enablePreferBestSource', 'false');
        }""",
        [FILTER_KEY, SAVED_SOURCES_KEY],
    )


def get_pref(page):
    return page.evaluate("(k) => localStorage.getItem(k)", FILTER_KEY)


def set_pref(page, enabled):
    page.evaluate(
        """([k, v]) => {
            localStorage.setItem(k, JSON.stringify(v));
            window.dispatchEvent(new CustomEvent('searchSettingsChanged',
                { detail: { filterAdultSources: v } }));
        }""",
        [FILTER_KEY, enabled],
    )


def source_table(page):
    """siteKey -> {name, is_adult}, as the app resolves them.

    Fetched from inside the page: middleware auth-gates /api/config/sources, so
    the request has to carry the login cookie.
    """
    return page.evaluate("async () => (await fetch('/api/config/sources')).json()")


def dismiss_overlays(page, attempts=6):
    """Close the first-run announcement modal.

    It renders a full-viewport `role=dialog` overlay that swallows pointer
    events, so nothing in the nav is clickable until it is dismissed. Dismissal
    is recorded in localStorage under the announcement text, which the test does
    not know, so click the close button instead.

    Retried because the modal mounts asynchronously: right after a navigation it
    is not in the DOM yet and a single early check would miss it.
    """
    for _ in range(attempts):
        try:
            page.wait_for_selector(
                "div[role='dialog']", state="attached", timeout=2000
            )
        except Exception:
            return
        dialog = page.locator("div[role='dialog']:visible")
        if not dialog.count():
            return
        try:
            dialog.first.locator("button[aria-label]").first.click(timeout=3000)
        except Exception:
            try:
                dialog.first.locator("button").last.click(timeout=3000)
            except Exception:
                return
        page.wait_for_timeout(500)


def open_settings(page):
    """Open 本地设置, retrying past the announcement overlay."""
    for _ in range(5):
        dismiss_overlays(page)
        # Two User Menu buttons exist (desktop nav + mobile header); only one is
        # visible at this viewport, so pick the visible one.
        page.locator("button[aria-label='User Menu']:visible").first.click()
        try:
            page.locator("button:has-text('设置'):visible").first.click(timeout=4000)
            page.wait_for_selector(f"h4:text('{TOGGLE_LABEL}')", timeout=10000)
            return
        except Exception:
            page.wait_for_timeout(500)
    raise RuntimeError("could not open the 本地设置 panel")


def close_settings(page):
    page.locator("button[aria-label='Close']:visible").first.click()


def toggle_row(page):
    return page.evaluate(
        """(label) => {
            const h4 = [...document.querySelectorAll('h4')]
                .find((h) => h.textContent.trim() === label);
            if (!h4) return null;
            const row = h4.closest('div.flex.items-center.justify-between');
            const box = row && row.querySelector("input[type='checkbox']");
            return box ? box.checked : null;
        }""",
        TOGGLE_LABEL,
    )


def click_toggle(page):
    """Click the visible switch. The checkbox itself is `sr-only`."""
    page.evaluate(
        """(label) => {
            const h4 = [...document.querySelectorAll('h4')]
                .find((h) => h.textContent.trim() === label);
            const row = h4.closest('div.flex.items-center.justify-between');
            row.querySelector('label').click();
        }""",
        TOGGLE_LABEL,
    )


# ---------------------------------------------------------------------------
# search page
# ---------------------------------------------------------------------------
class SearchCapture:
    """Records the /api/search payloads the page actually receives.

    Asserting on the response is stronger and less brittle than reading the DOM:
    it covers the whole chain (localStorage → query param → server → results)
    and sees every source even when the UI groups them into one card.

    Handles both response shapes the search route produces:
      - plain JSON  `{"results": [...]}`            (stream=0)
      - NDJSON      `{"site":"k","pageResults":[...]}` per line (stream=1)
    """

    def __init__(self, page, base):
        self.base = base
        self.payloads = []
        page.on("response", self._on_response)

    @staticmethod
    def _results_of(payload):
        if isinstance(payload, dict):
            if isinstance(payload.get("results"), list):
                return payload["results"]
            if isinstance(payload.get("pageResults"), list):
                return payload["pageResults"]
        return []

    def _on_response(self, response):
        url = response.url
        if "/api/search?" not in url or not url.startswith(self.base):
            return
        payloads = []
        try:
            payloads.append(response.json())
        except Exception:
            # Streaming search: one JSON object per line.
            try:
                text = response.text()
            except Exception:
                self.payloads.append(
                    {"url": url, "sources": [], "names": [], "error": "unreadable"}
                )
                return
            for line in text.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    payloads.append(json.loads(line))
                except Exception:
                    continue
        results = []
        for p in payloads:
            results.extend(self._results_of(p))
        # Recorded even when empty: "the search returned nothing" and "no search
        # request was made at all" are very different failures and the assertion
        # messages need to be able to tell them apart.
        failed = sorted(
            {
                f.get("key") or f.get("name")
                for p in payloads
                if isinstance(p, dict)
                for f in (p.get("failedSources") or [])
                if isinstance(f, dict)
            }
        )
        self.payloads.append(
            {
                "url": url,
                "sources": sorted({r.get("source") for r in results if r.get("source")}),
                "names": sorted(
                    {r.get("source_name") for r in results if r.get("source_name")}
                ),
                "count": len(results),
                "failed": failed,
            }
        )

    def reset(self):
        self.payloads = []

    def describe(self):
        """Compact summary for assertion failure messages."""
        if not self.payloads:
            return "no /api/search request was observed"
        return "; ".join(
            f"[{p['url'].split('?')[1]}] n={p.get('count', '?')} "
            f"sources={p['sources']} failed={p.get('failed', [])}"
            for p in self.payloads[:4]
        )

    @property
    def sources(self):
        out = set()
        for p in self.payloads:
            out.update(p["sources"])
        return out

    @property
    def names(self):
        out = set()
        for p in self.payloads:
            out.update(p["names"])
        return out


def search_source_keys(page, base, capture=None, attempts=2):
    """Source keys of the cards rendered on /search, read from their hrefs."""
    if capture:
        capture.reset()
    for attempt in range(attempts):
        page.goto(f"{base}/search?q={quote(TITLE)}", wait_until="domcontentloaded")
        try:
            page.wait_for_function(
                """() => document.querySelectorAll("a[href*='/play?source=']").length > 0""",
                timeout=SEARCH_TIMEOUT_MS,
            )
        except Exception:
            if capture:
                capture.reset()
            if attempt + 1 < attempts:
                # One reload before giving up: a dev server that is still
                # compiling /search can render the first paint without results.
                page.wait_for_timeout(SETTLE_MS)
                continue
        page.wait_for_timeout(SETTLE_MS)
        hrefs = page.eval_on_selector_all(
            "a[href*='/play?source=']", "els => els.map(e => e.getAttribute('href'))"
        )
        keys = set()
        for href in hrefs:
            q = parse_qs(urlparse(href).query)
            if "source" in q:
                keys.add(q["source"][0])
        if keys or attempt + 1 >= attempts:
            return sorted(keys)
    return sorted(keys)


def selector_source_names(page, base):
    """Names listed in the /search source-selector popup.

    The trigger's label comes from i18n (`allSources` / `nSources`); match both
    so the test survives a language switch.
    """
    page.goto(f"{base}/search?q={quote(TITLE)}", wait_until="domcontentloaded")
    trigger = page.locator(
        "button:has-text('全部源'), button:has-text('All sources')"
    ).first
    trigger.wait_for(timeout=SEARCH_TIMEOUT_MS)
    trigger.click()
    page.wait_for_timeout(1500)
    titles = page.eval_on_selector_all(
        "button[title]", "els => els.map(e => e.getAttribute('title'))"
    )
    known = ADULT_SOURCE_NAMES | NORMAL_SOURCE_NAMES
    return sorted({t for t in titles if t in known})


def play_page_sources(page, base, capture=None):
    """Source names the play page ends up with, plus the /api/search fan-out.

    Two independent signals:
      - `rendered`: source names visible in the play page source panel
      - `queried`:  sources present in the /api/search payload the page requested

    Returns (adult_rendered, normal_rendered, queried_source_keys).
    """
    if capture:
        capture.reset()
    page.goto(
        f"{base}/play?title={quote(TITLE)}&year={YEAR}", wait_until="domcontentloaded"
    )

    # The panel is collapsed by default for series (it has an episode list), so
    # the other sources only render after expanding it. The trigger is matched on
    # `aria-expanded` + i18n text to stay independent of styling and language.
    expander = page.locator(
        "button[aria-expanded='false']:has-text('另有'), "
        "button[aria-expanded='false']:has-text('more source')"
    )
    try:
        expander.first.wait_for(timeout=PLAY_TIMEOUT_MS)
        expander.first.click()
    except Exception:
        pass  # single-source result: nothing to expand
    page.wait_for_timeout(SETTLE_MS * 2)

    adult, normal = set(), set()
    # Rows stream in, so poll instead of sampling once.
    for _ in range(PLAY_TIMEOUT_MS // 500):
        rows = page.eval_on_selector_all(
            "button",
            """els => els.map(b => b.innerText.replace(/\\s+/g, ' ').trim())""",
        )
        for text in rows:
            head = text.split(" ")[0]
            if head in ADULT_SOURCE_NAMES:
                adult.add(head)
            elif head in NORMAL_SOURCE_NAMES:
                normal.add(head)
        if normal:
            break
        page.wait_for_timeout(500)

    queried = set(capture.sources) if capture else set()
    return sorted(adult), sorted(normal), sorted(queried)


# ---------------------------------------------------------------------------
def run(pw, base):
    browser = pw.chromium.launch(
        headless=True,
        args=["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
    )
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    for pattern in MEDIA_GLOBS:
        page.route(pattern, lambda route: route.abort())
    console_errors = []
    page.on(
        "console",
        lambda m: console_errors.append(m.text)
        if m.type == "error"
        and not any(n in m.text for n in EXPECTED_CONSOLE_NOISE)
        else None,
    )
    capture = SearchCapture(page, base)

    login(page, base)
    page.goto(base, wait_until="domcontentloaded")
    seed_prefs(page)
    page.reload(wait_until="domcontentloaded")

    sites = {s["key"]: s for s in source_table(page)}
    adult_keys = {
        k
        for k, s in sites.items()
        if is_adult(s.get("name")) or s.get("is_adult")
    }
    normal_keys = {k for k in sites if k not in adult_keys}
    ok(
        "profile contains adult sources (test is not vacuous)",
        len(adult_keys) >= 2,
        f"adult keys: {sorted(adult_keys)}",
    )
    ok(
        "profile contains normal sources",
        len(normal_keys) >= 2,
        f"normal keys: {sorted(normal_keys)}",
    )
    if len(adult_keys) < 2 or len(normal_keys) < 2:
        print("\nBoot with: node tests/e2e/serve.mjs --profile=avfilter")
        browser.close()
        return 1

    # ======================================================================
    # PHASE 1 — default (filtering on)
    # ======================================================================
    print("\n[1] default: filtering on", flush=True)
    open_settings(page)
    ok("toggle renders and is on by default", toggle_row(page) is True)
    ok(
        "default is not written to localStorage until changed",
        get_pref(page) is None,
        f"value={get_pref(page)!r}",
    )
    close_settings(page)

    keys_on = search_source_keys(page, base, capture)
    ok(
        "search: no adult source produced a card",
        not (set(keys_on) & adult_keys),
        f"card sources={keys_on} adult={sorted(adult_keys)}",
    )
    ok(
        "search: normal sources still produce cards",
        set(keys_on) & normal_keys != set(),
        f"card sources={keys_on}",
    )
    ok(
        "search: the /api/search payload contains no adult source",
        not (capture.sources & adult_keys),
        capture.describe(),
    )
    ok(
        "search: the /api/search payload carried filterAdult=1",
        any("filterAdult=1" in p["url"] for p in capture.payloads),
        capture.describe(),
    )
    ok(
        "search: the /api/search payload contains normal sources",
        bool(capture.sources & normal_keys),
        capture.describe(),
    )

    sel_on = selector_source_names(page, base)
    ok(
        "selector: lists no adult source",
        not (set(sel_on) & ADULT_SOURCE_NAMES),
        f"selector={sel_on}",
    )
    ok(
        "selector: still lists normal sources",
        bool(set(sel_on) & NORMAL_SOURCE_NAMES),
        f"selector={sel_on}",
    )

    adult_play_on, normal_play_on, queried_on = play_page_sources(page, base, capture)
    ok(
        "play page: source panel rendered the sources it found",
        bool(normal_play_on),
        f"rows={normal_play_on}",
    )
    ok(
        "play page: no adult source row",
        not adult_play_on,
        f"adult rows={adult_play_on} normal rows={normal_play_on}",
    )
    ok(
        "play page: the /api/search fan-out contained no adult source",
        not (set(queried_on) & adult_keys),
        f"queried={queried_on} adult={sorted(adult_keys)}",
    )
    ok(
        "play page: the /api/search fan-out still contained normal sources",
        bool(set(queried_on) & normal_keys),
        f"queried={queried_on}",
    )

    # ======================================================================
    # PHASE 2 — turn the toggle OFF through the UI
    # ======================================================================
    print("\n[2] toggle off through the settings panel", flush=True)
    open_settings(page)
    click_toggle(page)
    page.wait_for_timeout(500)
    ok("switch flips off", toggle_row(page) is False)
    ok("preference persisted as false", get_pref(page) == "false", f"value={get_pref(page)!r}")
    close_settings(page)

    keys_off = search_source_keys(page, base, capture)
    ok(
        "search: adult sources come back as cards",
        bool(set(keys_off) & adult_keys),
        f"card sources={keys_off} adult={sorted(adult_keys)}",
    )
    ok(
        "search: the /api/search payload now contains adult sources",
        bool(capture.sources & adult_keys),
        capture.describe(),
    )
    ok(
        "search: the /api/search payload no longer carries filterAdult",
        not any("filterAdult" in p["url"] for p in capture.payloads),
        capture.describe(),
    )

    sel_off = selector_source_names(page, base)
    ok(
        "selector: adult sources are listed again",
        bool(set(sel_off) & ADULT_SOURCE_NAMES),
        f"selector={sel_off}",
    )

    adult_play_off, normal_play_off, queried_off = play_page_sources(page, base, capture)
    ok(
        "play page: adult source rows appear",
        bool(adult_play_off),
        f"adult rows={adult_play_off} normal rows={normal_play_off}",
    )
    ok(
        "play page: the /api/search fan-out now includes adult sources",
        bool(set(queried_off) & adult_keys),
        f"queried={queried_off} adult={sorted(adult_keys)}",
    )

    # ======================================================================
    # PHASE 3 — savedSources round-trip
    # ======================================================================
    print("\n[3] savedSources round-trip", flush=True)
    adult_key = sorted(adult_keys)[0]
    page.evaluate(
        "([k, v]) => localStorage.setItem(k, v)",
        [SAVED_SOURCES_KEY, json.dumps([adult_key])],
    )
    keys_saved = search_source_keys(page, base)
    ok(
        "savedSources naming an adult source is honoured while off",
        adult_key in keys_saved,
        f"saved={adult_key} card sources={keys_saved}",
    )

    set_pref(page, True)
    page.goto(f"{base}/search?q={quote(TITLE)}", wait_until="domcontentloaded")
    page.wait_for_timeout(SETTLE_MS * 2)
    stored = page.evaluate("(k) => localStorage.getItem(k)", SAVED_SOURCES_KEY)
    ok(
        "turning filtering back on prunes the adult key from savedSources",
        stored is not None and adult_key not in json.loads(stored),
        f"savedSources={stored}",
    )

    # ======================================================================
    # PHASE 4 — reset
    # ======================================================================
    print("\n[4] reset", flush=True)
    page.evaluate("(k) => localStorage.removeItem(k)", FILTER_KEY)
    page.goto(base, wait_until="domcontentloaded")
    page.reload(wait_until="domcontentloaded")
    open_settings(page)
    page.locator("button:has-text('重置'):visible").first.click()
    page.wait_for_timeout(500)
    ok(
        "重置 restores the default (filtering on)",
        get_pref(page) == "true" and toggle_row(page) is True,
        f"value={get_pref(page)!r} checked={toggle_row(page)}",
    )
    close_settings(page)

    ok(
        "no unexpected console errors during the run",
        not console_errors,
        "; ".join(e[:160] for e in console_errors[:3]),
    )

    browser.close()
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:4020")
    a = ap.parse_args()

    with sync_playwright() as pw:
        rc = run(pw, a.url)

    passed = sum(1 for good, _, _ in RESULTS if good)
    failed = len(RESULTS) - passed
    print(f"\n{passed} passed, {failed} failed", flush=True)
    if failed:
        print("\nFailures:")
        for good, name, detail in RESULTS:
            if not good:
                print(f"  - {name}" + (f" — {detail}" if detail else ""))
    return rc or (1 if failed else 0)


if __name__ == "__main__":
    sys.exit(main())