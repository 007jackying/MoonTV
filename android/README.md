# DreamTV for Google TV

A WebView pointed at your own DreamTV instance. All the logic stays in the web app; this
exists to get an icon on the TV launcher, keep you logged in, and make the remote work.

User-facing setup and remote-control reference live in the main
[README](../README.md#android-tv--google-tv). This file is the build/maintenance side.

## Build

Needs JDK 17 (not 23 — AGP rejects it) and the Android SDK path in `local.properties`.

```sh
JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```

`moontv-tv.keystore` is gitignored. **Back it up** — without it, updates can't install
over an existing copy and friends have to uninstall first.

## Install

- You, over the network: `adb connect <tv-ip>:5555 && adb install -r app-release.apk`
- Friends: host the APK, they open it with the **Downloader** app on the TV
  (Settings → System → Developer options, then allow unknown sources for Downloader).

## What's in here

- `MainActivity.kt` — the WebView, the first-run setup screen (server address + site
  password), cookie persistence, `onRenderProcessGone` recovery, and console→logcat
  forwarding under tag `MoonTVWeb`. On landing at `/login` it POSTs the saved password to
  `/api/login` and continues to the original destination, so the TV never shows a login
  form. A wrong password falls through and leaves the normal form on screen.
- `TvNav.kt` — injected JS giving the WebView D-pad spatial navigation. Android WebView
  has **none**: arrow keys scroll the page instead of moving focus. Also keeps focus in a
  comfort band so content slides under a stationary focus, restores focus after SPA
  navigations, and implements `window.__tvBack()`.

The UA gets `MoonTV-TV` appended; `src/app/layout.tsx` reads it server-side and puts
`class="tv"` on `<html>`, so the first paint is already the TV layout. Everything
TV-specific keys off that class (`src/styles/tv.css`) or off the UA string.

## Gotchas

- `TEXT_ZOOM` in `MainActivity.kt` is the 10-foot readability knob — raise it if text is
  small on your TV. Don't add a second CSS scale on top; fixed-width pills will wrap.
- ArtPlayer's control bar is **unreachable by remote** — the controls are `<div>`s with no
  `tabindex`, inside a bar hidden until `.art-control-show`. TV affordances must not live
  there; that's why the play page has its own ▲/▼ menu in plain HTML.
- Android swallows the BACK key before it reaches the page, so overlays can't listen for
  it. `__tvBack()` clicks a hidden `[data-tv-dismiss]` button instead.
