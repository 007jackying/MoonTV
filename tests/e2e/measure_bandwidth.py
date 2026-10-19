#!/usr/bin/env python
"""
Page-weight / bandwidth probe: loads pages in Chromium and adds up the bytes
actually transferred (CDP encodedDataLength, headers included), split by who
served them — this site vs. every other host — and by resource type.

Use it to compare two deployments, e.g. before and after the poster proxy
(/api/img): with the proxy, poster bytes move from "other hosts" to "this
site", which is what your server / CDN egress bill sees. Each page is loaded
twice in the same browser profile: `cold` (empty cache) and `warm` (revisit).

Works against the local harness (tests/e2e/serve.mjs) or a real deployment:

  python tests/e2e/measure_bandwidth.py --url http://127.0.0.1:4020
  python tests/e2e/measure_bandwidth.py --url https://tv.example.com \
      --username admin --password '***' --json before.json

Pages default to the home page, a search and a play page; override with
--page (repeatable). Needs Playwright (`pip install playwright`); set
CHROMIUM_PATH to use an existing Chromium instead of `playwright install`.
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from urllib.parse import quote, urlparse

from playwright.sync_api import sync_playwright

TITLE = "测试影片 1"
DEFAULT_PAGES = [
    "/",
    f"/search?q={quote('测试影片')}",
    f"/play?source=src1&id=1&title={quote(TITLE)}",
]


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"


def scroll_through(page, steps=12):
    """Scroll to the bottom in viewport-sized steps so lazy images load."""
    for _ in range(steps):
        at_bottom = page.evaluate(
            "() => { window.scrollBy(0, window.innerHeight);"
            " return window.innerHeight + window.scrollY >= document.body.scrollHeight - 2; }"
        )
        page.wait_for_timeout(400)
        if at_bottom:
            break
    page.wait_for_load_state("networkidle")


def measure(context, url, origin, settle_ms, scroll):
    page = context.new_page()
    cdp = context.new_cdp_session(page)
    cdp.send("Network.enable")
    reqs = {}

    def on_request(e):
        reqs[e["requestId"]] = {"url": e["request"]["url"], "type": e.get("type", "Other"), "bytes": 0}

    def on_finished(e):
        if e["requestId"] in reqs:
            reqs[e["requestId"]]["bytes"] = e.get("encodedDataLength", 0)

    cdp.on("Network.requestWillBeSent", on_request)
    cdp.on("Network.loadingFinished", on_finished)

    page.goto(url, wait_until="networkidle")
    page.wait_for_timeout(settle_ms)
    if scroll:
        scroll_through(page)
    page.wait_for_timeout(settle_ms)
    page.close()

    out = {"site": defaultdict(lambda: [0, 0]), "other": defaultdict(lambda: [0, 0])}
    hosts = defaultdict(lambda: [0, 0])
    for r in reqs.values():
        if r["url"].startswith("data:"):
            continue
        parsed = urlparse(r["url"])
        where = "site" if f"{parsed.scheme}://{parsed.netloc}" == origin else "other"
        bucket = out[where][r["type"]]
        bucket[0] += 1
        bucket[1] += r["bytes"]
        if where == "other":
            hosts[parsed.netloc][0] += 1
            hosts[parsed.netloc][1] += r["bytes"]
    return {
        "site": {k: {"requests": v[0], "bytes": v[1]} for k, v in out["site"].items()},
        "other": {k: {"requests": v[0], "bytes": v[1]} for k, v in out["other"].items()},
        "other_hosts": {k: {"requests": v[0], "bytes": v[1]} for k, v in hosts.items()},
    }


def total(group):
    return sum(v["bytes"] for v in group.values()), sum(v["requests"] for v in group.values())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=os.environ.get("E2E_URL", "http://127.0.0.1:4020"))
    ap.add_argument("--page", action="append", help="path to load (repeatable)")
    ap.add_argument("--username", default=os.environ.get("E2E_USERNAME"))
    ap.add_argument("--password", default=os.environ.get("E2E_PASSWORD"))
    ap.add_argument("--mobile", action="store_true", help="390x844 phone viewport")
    ap.add_argument("--no-scroll", action="store_true", help="only what loads above the fold")
    ap.add_argument("--settle", type=int, default=1500, help="ms to wait after load")
    ap.add_argument("--json", help="write raw results here")
    args = ap.parse_args()

    origin = args.url.rstrip("/")
    pages = args.page or DEFAULT_PAGES
    viewport = {"width": 390, "height": 844} if args.mobile else {"width": 1366, "height": 900}
    results = {}

    with sync_playwright() as pw:
        launch = {"args": ["--headless=new"], "headless": False}
        if os.environ.get("CHROMIUM_PATH"):
            launch["executable_path"] = os.environ["CHROMIUM_PATH"]
        browser = pw.chromium.launch(**launch)
        for path in pages:
            context = browser.new_context(viewport=viewport)
            if args.password:
                body = {"password": args.password}
                if args.username:
                    body["username"] = args.username
                res = context.request.post(f"{origin}/api/login", data=body)
                if not res.ok:
                    sys.exit(f"login failed: {res.status} {res.text()[:200]}")
            results[path] = {
                phase: measure(context, origin + path, origin, args.settle, not args.no_scroll)
                for phase in ("cold", "warm")
            }
            context.close()
        browser.close()

    print(f"\n{origin}  ({'mobile' if args.mobile else 'desktop'}, {'no scroll' if args.no_scroll else 'scrolled to bottom'})")
    print(f"{'page':<42} {'visit':<5} {'this site':>22} {'  of which images':>22} {'other hosts':>22}")
    for path, phases in results.items():
        for phase, r in phases.items():
            site_b, site_n = total(r["site"])
            img = r["site"].get("Image", {"bytes": 0, "requests": 0})
            other_b, other_n = total(r["other"])
            print(
                f"{path[:42]:<42} {phase:<5} {human(site_b):>12} ({site_n:>3} req)"
                f" {human(img['bytes']):>12} ({img['requests']:>3} req)"
                f" {human(other_b):>12} ({other_n:>3} req)"
            )
            for host, h in sorted(r["other_hosts"].items(), key=lambda kv: -kv[1]["bytes"])[:5]:
                print(f"{'':<48}  └ {host}: {human(h['bytes'])} ({h['requests']} req)")

    if args.json:
        with open(args.json, "w") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        print(f"\nraw results → {args.json}")


if __name__ == "__main__":
    main()
