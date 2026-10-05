#!/usr/bin/env python
"""
Time-to-first-frame probe for the MoonTV play page.

Scenarios:
  clicked   /play?source=fast&id=fast-1&title=..&year=..   (user clicked a search result)
  cold      /play?title=..&year=..                          (user clicked a Douban card, no source)
  prefer    same as `clicked`, but with enablePreferBestSource=true

Usage:
  python tests/e2e/measure.py [--url http://127.0.0.1:4020] [--scenario clicked]
"""

import argparse
import json
import os
import sys

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(ROOT, "shots")
PASSWORD = os.environ.get("E2E_PASSWORD", "111111")
TITLE = "%E6%B5%8B%E8%AF%95%E5%BD%B1%E7%89%87 Test Movie"
YEAR = "2024"

# Installed before any page script runs. Finds the <video> as soon as React
# mounts it and records when a real frame became available.
INIT_SCRIPT = """
window.__m = { videoFound: null, loadeddata: null, playing: null, firstFrame: null,
               loadedmetadata: null, url: null };
const t0 = performance.now();
window.__t0 = t0;
function hook(v) {
  if (!v || v.__hooked) return;
  v.__hooked = true;
  window.__m.videoFound = performance.now() - t0;
  window.__m.url = v.currentSrc || v.src || null;
  const mark = (k) => () => {
    if (window.__m[k] == null) window.__m[k] = performance.now() - t0;
  };
  v.addEventListener('loadedmetadata', mark('loadedmetadata'), { once: true });
  v.addEventListener('loadeddata', mark('loadeddata'), { once: true });
  v.addEventListener('playing', mark('playing'), { once: true });
  const tick = () => {
    if (window.__m.firstFrame == null && v.readyState >= 2) {
      window.__m.firstFrame = performance.now() - t0;
    }
  };
  v.addEventListener('timeupdate', tick);
  v.addEventListener('progress', tick);
  v.addEventListener('canplay', tick);
}
function sweep() {
  document.querySelectorAll('video').forEach(hook);
  if (window.__m.firstFrame != null) return true;
  requestAnimationFrame(sweep);
}
// document.documentElement does not exist yet when init scripts run, so
// observe `document` and also run a rAF sweep as a belt-and-braces fallback.
new MutationObserver(sweep).observe(document, { childList: true, subtree: true });
sweep();
"""


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


def run(pw, base, scenario, timeout_ms):
    browser = pw.chromium.launch(
        headless=True,
        args=["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
    )
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.add_init_script(INIT_SCRIPT)

    console_errors = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    login(page, base)

    # per-scenario prefs. Clear stored data first so a play record from a
    # previous run cannot change which episode is selected.
    page.goto(base, wait_until="domcontentloaded")
    page.evaluate(
        """(prefer) => {
            localStorage.removeItem('moontv_play_records');
            localStorage.removeItem('moontv_cache_default');
            localStorage.setItem('enablePreferBestSource', prefer ? 'true' : 'false');
            localStorage.setItem('enableOptimization', 'true');
        }""",
        scenario == "prefer",
    )

    if scenario == "cold":
        url = f"{base}/play?title={TITLE}&year={YEAR}"
    else:
        url = f"{base}/play?source=fast&id=fast-1&title={TITLE}&year={YEAR}"

    page.goto(url, wait_until="commit")

    # Wait for a decoded frame, or bail out.
    try:
        page.wait_for_function(
            "() => window.__m && window.__m.firstFrame != null",
            timeout=timeout_ms,
        )
        got_frame = True
    except Exception:
        got_frame = False

    # Always let the rest of the pipeline settle so we can report side-panel state.
    page.wait_for_timeout(6000)

    m = page.evaluate("window.__m")
    spinner_gone = page.evaluate(
        """() => !document.body.innerText.includes('正在搜索')
             && !document.querySelector('[role=status] .animate-spin')"""
    )
    src_rows = page.evaluate(
        """() => {
            const btns = [...document.querySelectorAll('button')]
                .filter(b => /^E2E-/.test(b.innerText.trim()));
            return btns.map(b => b.innerText.replace(/\\s+/g, ' ').trim());
        }"""
    )

    os.makedirs(SHOTS, exist_ok=True)
    shot = os.path.join(SHOTS, f"{scenario}.png")
    page.screenshot(path=shot)

    result = {
        "scenario": scenario,
        "got_frame": got_frame,
        "video_mounted_ms": round(m.get("videoFound"), 0) if m.get("videoFound") else None,
        "loadeddata_ms": round(m.get("loadeddata"), 0) if m.get("loadeddata") else None,
        "first_frame_ms": round(m.get("firstFrame"), 0) if m.get("firstFrame") else None,
        "playing_ms": round(m.get("playing"), 0) if m.get("playing") else None,
        "video_src": m.get("url"),
        "spinner_cleared": spinner_gone,
        "source_rows": src_rows,
        "console_errors": console_errors[:5],
        "screenshot": shot,
    }
    browser.close()
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:4020")
    ap.add_argument("--scenario", default="clicked",
                    choices=["clicked", "cold", "prefer"])
    ap.add_argument("--timeout", type=int, default=60000)
    a = ap.parse_args()

    with sync_playwright() as pw:
        r = run(pw, a.url, a.scenario, a.timeout)
    print(json.dumps(r, indent=2, ensure_ascii=False))
    return 0 if r["got_frame"] else 1


if __name__ == "__main__":
    sys.exit(main())
