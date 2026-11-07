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
expect_exit 1 --no-config examples/before
expect_exit 0 --config examples/after.config.json examples/after
# The example asks for fields the clean site does not carry, so errors here are correct.
expect_exit 1 --config examples/builtcheck.config.json --quiet tests/fixtures/clean-site/site

expect_exit 1 --no-config tests/fixtures/bad-foundation/site --format json --output "$OUT/report.json"
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if (r.summary.errors < 1) process.exit(1);' "$OUT/report.json"
echo "ok: JSON report parses"

expect_exit 1 --no-config tests/fixtures/bad-foundation/site --format html --output "$OUT/report.html"
grep -q "foundation/sitemap-stale-url" "$OUT/report.html"
echo "ok: HTML report written"

# Pack the package, install the file into an empty project, and run what got installed.
mkdir "$OUT/project"
npm pack --silent --pack-destination "$OUT" >/dev/null
npm install --silent --no-audit --no-fund --offline --prefix "$OUT/project" "$OUT"/builtcheck-*.tgz >/dev/null
INSTALLED="$OUT/project/node_modules/.bin/builtcheck"
"$INSTALLED" --version >/dev/null
"$INSTALLED" --help >/dev/null
status=0
"$INSTALLED" "$OUT/project/node_modules/builtcheck/examples/before" --no-config >/dev/null || status=$?
if [ "$status" -ne 1 ]; then
  echo "FAIL: the installed package exited $status on the example site, expected 1"
  exit 1
fi
echo "ok: the packed package installs and runs"

echo "All checks passed."
