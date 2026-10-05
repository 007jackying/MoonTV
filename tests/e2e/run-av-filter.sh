#!/usr/bin/env bash
# One-command runner for the AV-source filter e2e suite.
#
#   ./tests/e2e/run-av-filter.sh
#
# Boots the harness with the `avfilter` profile (which adds adult sources to
# config.json), waits for the app to answer, runs both suites, then tears the
# harness down so config.json / src/lib/runtime.ts are restored.
#
# The API suite (test_av_filter.mjs) needs nothing but node.
# The browser suite (test_av_filter.py) needs playwright + chromium:
#
#   uv venv .e2e-venv && uv pip install --python .e2e-venv/bin/python playwright
#   .e2e-venv/bin/python -m playwright install chromium
#   PYTHON=.e2e-venv/bin/python ./tests/e2e/run-av-filter.sh
#
# Pass --api-only to skip the browser suite.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LOG="${E2E_LOG:-/tmp/moontv-e2e-avfilter.log}"
PYTHON="${PYTHON:-python3}"
API_ONLY=0
[ "${1:-}" = "--api-only" ] && API_ONLY=1

# Ports. Override E2E_PORT / MOCK_PORT if the defaults are taken (e.g. by a
# `next dev` you already have running on 4020) — serve.mjs refuses to boot on an
# occupied port precisely so two harnesses cannot fight over config.json.
export E2E_PORT="${E2E_PORT:-4020}"
export MOCK_PORT="${MOCK_PORT:-4010}"
export E2E_URL="${E2E_URL:-http://127.0.0.1:$E2E_PORT}"
export E2E_CMS_URL="${E2E_CMS_URL:-http://127.0.0.1:$MOCK_PORT}"

# Dev or production build? Production by default: `next dev` compiles routes on
# demand and its long-lived sessions turned out to be unreliable for a browser
# suite that drives the app for several minutes (requests occasionally come back
# empty, and the HLS proxy path wedges the process). Set E2E_MODE=dev for a
# faster, more editable loop when you only care about a subset of the suite.
E2E_MODE="${E2E_MODE:-build}"
case "$E2E_MODE" in
  build) HARNESS_FLAGS=(--build --profile=avfilter) ;;
  dev)   HARNESS_FLAGS=(--profile=avfilter) ;;
  *)     echo "[av-filter] E2E_MODE must be 'build' or 'dev', got '$E2E_MODE'" >&2; exit 2 ;;
esac

cd "$ROOT"

if [ -e .e2e-backup ]; then
  echo "[av-filter] refusing to start: .e2e-backup exists, a previous harness" >&2
  echo "[av-filter] run did not clean up. Remove it after checking config.json." >&2
  exit 2
fi

node tests/e2e/serve.mjs "${HARNESS_FLAGS[@]}" >"$LOG" 2>&1 &
HARNESS_PID=$!

teardown() {
  # SIGTERM so serve.mjs runs its cleanup and restores config.json + runtime.ts.
  kill -TERM "$HARNESS_PID" 2>/dev/null
  wait "$HARNESS_PID" 2>/dev/null
}
trap teardown EXIT INT TERM

echo "[av-filter] booting harness mode=$E2E_MODE (log: $LOG) ..."
for _ in $(seq 1 180); do
  grep -q "\[e2e\] READY" "$LOG" && break
  if ! kill -0 "$HARNESS_PID" 2>/dev/null; then
    echo "[av-filter] harness died during boot; tail of $LOG:" >&2
    tail -30 "$LOG" >&2
    exit 2
  fi
  sleep 1
done
if ! grep -q "\[e2e\] READY" "$LOG"; then
  echo "[av-filter] app did not become ready in 180s; tail of $LOG:" >&2
  tail -30 "$LOG" >&2
  exit 2
fi
grep "\[e2e\] READY" "$LOG"

# serve.mjs warms /search and /play itself; wait for that to finish so cold
# on-demand compilation never lands inside an assertion.
for _ in $(seq 1 120); do
  grep -q "\[e2e\] warmed" "$LOG" && break
  sleep 1
done
grep "\[e2e\] warmed" "$LOG" || echo "[av-filter] (warmup still running)"

rc=0

echo
echo "== API suite =="
node tests/e2e/test_av_filter.mjs || rc=1

if [ "$API_ONLY" -eq 0 ]; then
echo
echo "== browser suite =="
if ! "$PYTHON" -c "import playwright" >/dev/null 2>&1; then
  echo "[av-filter] SKIP: playwright not importable by '$PYTHON'."
  echo "[av-filter] see the header of this script for how to install it,"
  echo "[av-filter] or re-run with --api-only."
else
  "$PYTHON" tests/e2e/test_av_filter.py --url "$E2E_URL" || rc=1
fi
fi

echo
if [ "$rc" -eq 0 ]; then
  echo "[av-filter] PASS"
else
  echo "[av-filter] FAIL"
fi
exit "$rc"