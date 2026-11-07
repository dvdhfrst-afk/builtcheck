#!/bin/sh
# Runs the test suite, then exercises the command line end to end on the fixture sites.
set -eu

cd "$(dirname "$0")"

node --test

BIN=bin/builtcheck.js
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

expect_exit() {
  wanted=$1
  shift
  status=0
  node "$BIN" "$@" >/dev/null 2>&1 || status=$?
  if [ "$status" -ne "$wanted" ]; then
    echo "FAIL: builtcheck $* exited $status, expected $wanted"
    exit 1
  fi
  echo "ok: builtcheck $* exits $wanted"
}

expect_exit 0 --version
expect_exit 0 --list-rules
expect_exit 0 --no-config tests/fixtures/clean-site/site
expect_exit 1 --no-config tests/fixtures/no-foundation/site
expect_exit 1 --no-config tests/fixtures/bad-foundation/site
expect_exit 1 --config tests/fixtures/bad-pages/config.json tests/fixtures/bad-pages/site
expect_exit 2 --no-config tests/fixtures/does-not-exist
# The example asks for fields the clean site does not carry, so errors here are correct.
expect_exit 1 --config examples/builtcheck.config.json --quiet tests/fixtures/clean-site/site

expect_exit 1 --no-config tests/fixtures/bad-foundation/site --format json --output "$OUT/report.json"
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if (r.summary.errors < 1) process.exit(1);' "$OUT/report.json"
echo "ok: JSON report parses"

expect_exit 1 --no-config tests/fixtures/bad-foundation/site --format html --output "$OUT/report.html"
grep -q "foundation/sitemap-stale-url" "$OUT/report.html"
echo "ok: HTML report written"

echo "All checks passed."
