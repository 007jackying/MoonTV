"""
End-to-end tests for 去广告 (ad removal) on the play page.

CMS sources inject ads as a block of segments between two
#EXT-X-DISCONTINUITY tags. The old 去广告 deleted only those tags and left the
ad segments in place, so whether an ad was hidden depended on where its
timestamps happened to land: a mid-roll ad with its own timestamps vanished
by accident, a pre-roll ad still played and ate the start of the episode, and
an ad with unrelated timestamps froze playback. The new filter
(src/lib/player/adFilter.ts) removes the ad segments and keeps the tags
between the remaining content.

Each test splices ads into the mock's real 720p playlist with Playwright
request routing (no harness change). The ad clips come from make-media.sh:
6 s of solid red with a 1 kHz tone in /media/ads/ (timestamps from zero) and
/media/adsfar/ (timestamps 5000 s away). Only the first two ad segments (4 s)
are spliced in so the ad stays under the filter's one-third safety cap on the
12 s fixture. An init script samples the picture every 100 ms and counts
frames that are entirely red, so "the ad was on screen" is observed, not
inferred from network requests.

The ad fixtures are MPEG-TS in the default H.264 build, the format real
sources use. The suite needs a browser that decodes H.264 (Chrome, or Chrome
for Testing via E2E_CHROMIUM); with VP9 fixtures (CODEC=vp9) the clips are
fMP4 and the splice adds the matching #EXT-X-MAP lines.

Run:  node tests/e2e/serve.mjs --build
      python -m pytest tests/e2e/test_ad_filter.py -v
"""

import os

import pytest
from playwright.sync_api import sync_playwright

BASE = os.environ.get("E2E_URL", "http://127.0.0.1:4020")
PASSWORD = os.environ.get("E2E_PASSWORD", "111111")
MOCK_ORIGIN = f"http://127.0.0.1:{os.environ.get('MOCK_PORT', '4010')}"
TITLE = "%E6%B5%8B%E8%AF%95%E5%BD%B1%E7%89%87 Test Movie"
PLAY_URL = f"{BASE}/play?source=fast&id=fast-1&title={TITLE}&year=2024"
CONTENT_SECONDS = 12
AD_SECONDS = 4
D = "#EXT-X-DISCONTINUITY"

# Count fully red frames (the ad) on the first <video>; stop at its first
# 'ended', because the play page then auto-advances to episode 2.
INIT_SCRIPT = """
window.__ad = { red: 0, frames: 0, ended: false, maxTime: 0, firstTime: null, notices: [] };
(() => {
  const c = document.createElement('canvas'); c.width = 32; c.height = 18;
  const g = c.getContext('2d', { willReadFrequently: true });
  let video = null;
  const sample = () => {
    const v = video || (video = document.querySelector('video'));
    if (!v || window.__ad.ended) return;
    if (v.readyState < 2 || v.paused) return;
    try { g.drawImage(v, 0, 0, 32, 18); } catch { return; }
    const pts = [[2, 2], [29, 2], [16, 9], [2, 15], [29, 15]]
      .map(([x, y]) => g.getImageData(x, y, 1, 1).data);
    const red = pts.every((p) => p[0] > 170 && p[1] < 80 && p[2] < 80);
    window.__ad.frames++;
    if (red) window.__ad.red++;
    if (window.__ad.firstTime === null) window.__ad.firstTime = v.currentTime;
    window.__ad.maxTime = Math.max(window.__ad.maxTime, v.currentTime);
    if (!v.__adHooked) {
      v.__adHooked = true;
      v.addEventListener('ended', () => { window.__ad.ended = true; }, { once: true });
    }
  };
  setInterval(sample, 100);
  new MutationObserver(() => {
    const t = document.body && document.body.innerText;
    const m = t && t.match(/已去除 \\d+ 段广告（\\d+ 秒）/);
    if (m && !window.__ad.notices.includes(m[0])) window.__ad.notices.push(m[0]);
  }).observe(document, { childList: true, subtree: true, characterData: true });
})();
"""


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=True,
            # See tests/e2e/README.md: optional preinstalled Chromium / Chrome.
            executable_path=os.environ.get("E2E_CHROMIUM") or None,
            args=["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
        )
        yield b
        b.close()


def _splice(playlist: str, where: str, ad_dir: str) -> str:
    """Insert two ad segments from /media/<ad_dir>/ the way CMS sources do."""
    lines = playlist.strip().split("\n")
    first = next(i for i, l in enumerate(lines) if l.startswith("#EXTINF"))
    end = lines.index("#EXT-X-ENDLIST")
    header, body = lines[:first], lines[first:end]
    content_map = next((l for l in header if l.startswith("#EXT-X-MAP")), None)
    ad = []
    if content_map:  # fMP4 (CODEC=vp9): the ad has its own init segment
        ad.append(f'#EXT-X-MAP:URI="/media/{ad_dir}/init.mp4"')
    for i in range(2):
        ad += ["#EXTINF:2.000000,", f"/media/{ad_dir}/ad_{i:03d}.{'m4s' if content_map else 'ts'}"]
    back = [content_map] if content_map else []
    if where == "pre":
        out = header + ad + [D] + back + body
    else:  # mid: after the third content segment (6 s)
        out = header + body[:6] + [D] + ad + [D] + back + body[6:]
    return "\n".join(out + ["#EXT-X-ENDLIST", ""])


def _open(browser, *, where: str, ad_dir: str = "ads", block_ad: bool = True, resume_at=None):
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    def handle(route):
        resp = route.fetch()
        route.fulfill(response=resp, body=_splice(resp.text(), where, ad_dir))

    page.route(f"{MOCK_ORIGIN}/media/720p/v0.m3u8", handle)
    page.add_init_script(INIT_SCRIPT)
    page.goto(f"{BASE}/login", wait_until="domcontentloaded")
    page.evaluate(
        """async ([pw, blockAd, resumeAt]) => {
            await fetch('/api/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ password: pw }),
            });
            localStorage.removeItem('moontv_play_records');
            localStorage.setItem('enablePreferBestSource', 'false');
            localStorage.setItem('enable_blockad', String(blockAd));
            if (resumeAt != null) {
                localStorage.setItem('moontv_play_records', JSON.stringify({
                    'fast+fast-1': {
                        title: '测试影片 Test Movie', source_name: 'E2E-fast', cover: '',
                        year: '2024', index: 1, total_episodes: 12, play_time: resumeAt,
                        total_time: 12, save_time: Date.now(), search_title: '',
                    },
                }));
            }
        }""",
        [PASSWORD, block_ad, resume_at],
    )
    page.goto(PLAY_URL, wait_until="domcontentloaded")
    return ctx, page, errors


def _play_to_end(page, timeout_ms=40000):
    """Play the first episode at 2x until it ends; return the frame record."""
    page.wait_for_function(
        "() => { const v = document.querySelector('video'); return v && v.readyState >= 2; }",
        timeout=30000,
    )
    page.evaluate("document.querySelector('video').playbackRate = 2")
    page.wait_for_function("() => window.__ad.ended", timeout=timeout_ms)
    return page.evaluate("window.__ad")


def _video_duration(page):
    return page.evaluate("document.querySelector('video').duration")


@pytest.mark.parametrize("where", ["mid", "pre"])
def test_ad_is_never_on_screen_and_the_episode_is_complete(browser, where):
    ctx, page, errors = _open(browser, where=where)
    try:
        page.wait_for_function(
            "() => { const v = document.querySelector('video'); return v && v.duration > 0; }",
            timeout=30000,
        )
        # Read while the stream is still loading: the seek bar's length comes
        # from the playlist, so the ad's seconds used to show up in it.
        duration = _video_duration(page)
        rec = _play_to_end(page)
        problems = []
        if rec["red"]:
            problems.append(f"ad on screen for {rec['red']} sampled frames")
        if rec["firstTime"] >= 1:
            problems.append(f"episode started at {rec['firstTime']:.1f}s, not at 0")
        if rec["maxTime"] <= CONTENT_SECONDS - 0.5:
            problems.append(f"episode stopped at {rec['maxTime']:.1f}s")
        if abs(duration - CONTENT_SECONDS) >= 0.5:
            problems.append(f"timeline is {duration:.1f}s, not {CONTENT_SECONDS}s")
        if rec["notices"] != [f"已去除 1 段广告（{AD_SECONDS} 秒）"]:
            problems.append(f"notices {rec['notices']}")
        assert not problems, problems
        assert not errors, errors
    finally:
        ctx.close()


@pytest.mark.parametrize("where", ["mid", "pre"])
def test_ad_with_unrelated_timestamps_does_not_freeze_playback(browser, where):
    """The old filter froze here: the ad's 5000 s timestamps left a gap."""
    ctx, page, errors = _open(browser, where=where, ad_dir="adsfar")
    try:
        rec = _play_to_end(page)
        assert rec["red"] == 0, rec
        assert rec["maxTime"] > CONTENT_SECONDS - 0.5, rec
        assert not errors, errors
    finally:
        ctx.close()


def test_resume_lands_in_the_episode_not_in_the_ad(browser):
    """Resuming (继续观看) at 7 s, just after where the ad was spliced in, plays
    the episode from 7 s. A guard rather than a regression test: the old
    filter also got this right in the app, because the player seeks after the
    stream starts loading from 0."""
    ctx, page, errors = _open(browser, where="mid", resume_at=7)
    try:
        page.wait_for_function(
            "() => { const v = document.querySelector('video');"
            " return v && v.readyState >= 2 && !v.paused && v.currentTime > 6; }",
            timeout=30000,
        )
        rec = _play_to_end(page)
        assert rec["red"] == 0, rec
        assert 6 <= rec["firstTime"] < 8, rec
        assert not errors, errors
    finally:
        ctx.close()


def test_switching_it_off_plays_the_ad(browser):
    """Control: proves the frame sampling really sees the ad, so the zero
    counts above mean the ad was removed, not that it went unnoticed."""
    ctx, page, errors = _open(browser, where="mid", block_ad=False)
    try:
        page.wait_for_function(
            "() => { const v = document.querySelector('video'); return v && v.duration > 0; }",
            timeout=30000,
        )
        assert abs(_video_duration(page) - (CONTENT_SECONDS + AD_SECONDS)) < 0.5
        rec = _play_to_end(page)
        # 4 s of ad at 2x, sampled every 100 ms: ~20 frames
        assert rec["red"] >= 10, rec
        assert rec["notices"] == [], rec
        assert not errors, errors
    finally:
        ctx.close()
