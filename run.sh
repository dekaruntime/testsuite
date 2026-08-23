#!/usr/bin/env bash
#
# Run the deka conformance suite.
#
#   ./run.sh                    build both compilers from a local deka checkout
#                               and grade THAT code (the default: you are
#                               testing what you are writing)
#   ./run.sh --published        grade the published release instead
#   ./run.sh --deka ~/src/deka  point at a specific checkout
#   ./run.sh --write-baseline   accept the current results as the known set
#
# Everything the run depends on is set up or verified here, because every one of
# these has silently produced a confident wrong answer:
#
#   - no chromium        -> browser host drops, suite reports 0 divergences
#                           forever and the summary looks healthier than a
#                           correct run (535/50/0 vs the true 533/44/8)
#   - stale native build -> grades your change with an old compiler and
#                           manufactures divergences out of type-name drift
#   - mixed hosts        -> one local + one published renders `int` vs `number`
#                           as native/browser disagreement
#
# The point of this file is that none of those are the human's job to remember.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
SUITE_ROOT="$PWD"

MODE="local"
DEKA_REPO="${DEKA_REPO:-}"
PASSTHRU=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --published)  MODE="published"; shift ;;
    --local)      MODE="local"; shift ;;
    --deka)       DEKA_REPO="$2"; shift 2 ;;
    --deka=*)     DEKA_REPO="${1#*=}"; shift ;;
    -h|--help)    sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            PASSTHRU+=("$1"); shift ;;
  esac
done

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarn \033[0m %s\n' "$*"; }

# Every fatal says what broke AND how to fix it. An error that only names the
# problem makes the reader go find the remedy; at 2am they guess instead.
die() {
  printf '\n\033[31mfatal\033[0m %s\n' "$1" >&2
  # NOT `[[ ... ]] && printf` -- under `set -e` that AND-list returns non-zero
  # when there is no second argument and kills the script before `exit 2`,
  # turning every remedy-less fatal into a bare exit 1.
  if [[ $# -gt 1 ]]; then
    printf '      fix: %s\n' "$2" >&2
  fi
  printf '\nEnvironment is not fit to grade. This is NOT a verdict on your change.\n' >&2
  exit 2
}

# --------------------------------------------------------------------- bun ---
# Neither bun nor node is on a non-login shell's PATH on the fleet macs.
if ! command -v bun >/dev/null 2>&1; then
  for candidate in "$HOME/.bun/bin" /usr/local/bin /opt/homebrew/bin; do
    [[ -x "$candidate/bun" ]] && PATH="$candidate:$PATH" && break
  done
fi
command -v bun >/dev/null 2>&1 || die "bun is not installed or not on PATH" "install from https://bun.sh, or add ~/.bun/bin to PATH"
say "bun $(bun --version)"

# ---------------------------------------------------------------- deps -------
if [[ ! -d node_modules ]]; then
  say "installing dependencies"
  bun install
fi

# playwright drives the browser host. Its absence is not fatal to the harness --
# it degrades to native-only and still prints a plausible summary -- which is
# exactly why this script treats it as fatal.
if [[ ! -d node_modules/playwright ]]; then
  say "installing dependencies (playwright missing)"
  bun install
fi
[[ -d node_modules/playwright ]] || die "playwright is still missing after bun install" "check package.json devDependencies, then: bun install --force"

# Chromium itself is a separate download from the npm package. Idempotent, and
# a no-op once present.
say "ensuring chromium for the browser host"
bunx playwright install chromium

# --------------------------------------------------------------- compilers ---
if [[ "$MODE" == "published" ]]; then
  say "mode: PUBLISHED -- grading the released compilers from wasm.deka.gg / releases.deka.gg"
  warn "tests/baseline.txt is recorded against a local build; a published run may"
  warn "differ by version drift as well as by regression."
  unset DEKA_NATIVE DEKA_WASM || true
else
  # Locate the deka checkout.
  if [[ -z "$DEKA_REPO" ]]; then
    for candidate in ../deka "$HOME/Projects/deka" "$HOME/src/deka"; do
      [[ -f "$candidate/crates/cli/Cargo.toml" ]] && DEKA_REPO="$candidate" && break
    done
  fi
  [[ -n "$DEKA_REPO" ]] || die "no deka checkout found (looked in ../deka, ~/Projects/deka, ~/src/deka)" "./run.sh --deka /path/to/deka   (or set DEKA_REPO, or use --published)"
  # Resolve only after confirming it exists: a bare `cd` into a missing path
  # aborts under `set -e` with bash's own message instead of the remedy below.
  [[ -d "$DEKA_REPO" ]] || die "no such directory: $DEKA_REPO" \
    "check the --deka path, or use ./run.sh --published"
  DEKA_REPO="$(cd "$DEKA_REPO" && pwd)"
  [[ -f "$DEKA_REPO/crates/cli/Cargo.toml" ]] || die "$DEKA_REPO is not a deka checkout (no crates/cli/Cargo.toml)" "point --deka at the deka repo root"

  say "mode: LOCAL -- grading $DEKA_REPO ($(git -C "$DEKA_REPO" rev-parse --short HEAD 2>/dev/null || echo '?'))"

  command -v cargo >/dev/null 2>&1 || die "cargo not found, needed to build the local compilers" "install rust from https://rustup.rs, or use ./run.sh --published"

  # The wasm target is a separate rustup component and its absence surfaces as a
  # confusing linker error rather than a missing-target message.
  if ! rustup target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown; then
    say "adding wasm32-unknown-unknown target"
    rustup target add wasm32-unknown-unknown
  fi

  # Build BOTH, always. cargo is incremental so an up-to-date tree is seconds,
  # and rebuilding is the only way to guarantee the two hosts came from the same
  # source. A stale binary is the failure this removes rather than detects.
  say "building native CLI"
  ( cd "$DEKA_REPO" && cargo build --release -p cli )

  say "building browser compiler (wasm)"
  ( cd "$DEKA_REPO" && CARGO_INCREMENTAL=0 cargo build --release \
      --target wasm32-unknown-unknown -p deka_compiler_wasm --no-default-features )

  export DEKA_NATIVE="$DEKA_REPO/target/release/cli"
  export DEKA_WASM="$DEKA_REPO/target/wasm32-unknown-unknown/release/deka_compiler_wasm.wasm"

  [[ -x "$DEKA_NATIVE" ]] || die "native CLI missing after a successful build: $DEKA_NATIVE" "check CARGO_TARGET_DIR is not redirecting the build elsewhere"
  [[ -f "$DEKA_WASM"   ]] || die "wasm compiler missing after a successful build: $DEKA_WASM" "check CARGO_TARGET_DIR is not redirecting the build elsewhere"
fi

# -------------------------------------------------------------------- run ----
# run-tests.mjs --gate re-verifies all of the above independently: it is the
# backstop for anyone who bypasses this script, not a duplicate of it.
say "running the suite (both hosts)"
echo
set +e
bun "$SUITE_ROOT/scripts/run-tests.mjs" --gate "${PASSTHRU[@]+"${PASSTHRU[@]}"}"
STATUS=$?
set -e

echo
case $STATUS in
  0) say "PASS -- no new failures" ;;
  1) say "FAIL -- new failure(s); see the list above and .cache/gate-report.txt" ;;
  2) say "BLOCKED -- environment unfit to grade; this is not a verdict on your change" ;;
  *) say "exited $STATUS" ;;
esac
exit $STATUS
