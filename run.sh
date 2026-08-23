#!/usr/bin/env bash
#
# Test a deka runtime checkout against the conformance suite.
#
#   ./run.sh ~/Projects/deka   build the native CLI and the wasm compiler from
#                              that checkout, then run every fixture against
#                              both hosts
#   ./run.sh                   same, finding the checkout automatically
#                              ($DEKA_REPO, ../deka, ~/Projects/deka, ~/src/deka)
#   ./run.sh --published       test the released compilers instead of a checkout
#
# Results print to the terminal and land in .cache/report.txt. Failures and
# native/browser divergences are findings to read, not a pass/fail verdict --
# this reports on a runtime, it does not compare it to a stored list.
#
# Everything the run depends on is installed or verified here, because each of
# these has silently produced a confident wrong answer:
#
#   no chromium         the browser host drops and the suite reports 0
#                       divergences no matter what the browser compiler does.
#                       That run looks HEALTHIER than a correct one:
#                       535 pass / 50 fail / 0 divergent, against the true
#                       533 / 44 / 8 on the same commit.
#
#   stale native build  a binary older than its own tree grades your code with
#                       an old compiler. Pairing native 0.25.7 against a current
#                       wasm manufactured 8 divergences that were really
#                       `int` vs `number` type-name drift.
#
#   mixed hosts         one local compiler and one published one is the same
#                       failure wearing different clothes.
#
# None of that is the reader's job to remember. That is the point of this file.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
SUITE_ROOT="$PWD"

MODE="local"
DEKA_REPO="${DEKA_REPO:-}"
PASSTHRU=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --published) MODE="published"; shift ;;
    --local)     MODE="local"; shift ;;
    --deka)      DEKA_REPO="$2"; shift 2 ;;
    --deka=*)    DEKA_REPO="${1#*=}"; shift ;;
    -h|--help)   sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)          PASSTHRU+=("$1"); shift ;;
    # The first bare argument is the runtime checkout to test.
    *)           if [[ -z "$DEKA_REPO" ]]; then DEKA_REPO="$1"; else PASSTHRU+=("$1"); fi; shift ;;
  esac
done

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarn \033[0m %s\n' "$*"; }

# Every fatal names the problem AND the remedy. An error that only names the
# problem sends the reader hunting; at 2am they guess instead.
die() {
  printf '\n\033[31mfatal\033[0m %s\n' "$1" >&2
  # NOT `[[ ... ]] && printf` -- under `set -e` that AND-list returns non-zero
  # when there is no remedy argument and kills the script before `exit 2`,
  # turning every remedy-less fatal into a bare exit 1 that reads like a real
  # test failure. Found by injecting the faults rather than reasoning about them.
  if [[ $# -gt 1 ]]; then
    printf '      fix: %s\n' "$2" >&2
  fi
  printf '\nEnvironment is not fit to run. This is NOT a result for your runtime.\n' >&2
  exit 2
}

# --------------------------------------------------------------------- bun ---
# Neither bun nor node is on a non-login shell's PATH on the fleet macs.
if ! command -v bun >/dev/null 2>&1; then
  for candidate in "$HOME/.bun/bin" /usr/local/bin /opt/homebrew/bin; do
    [[ -x "$candidate/bun" ]] && PATH="$candidate:$PATH" && break
  done
fi
command -v bun >/dev/null 2>&1 \
  || die "bun is not installed or not on PATH" \
         "install from https://bun.sh, or add ~/.bun/bin to PATH"
say "bun $(bun --version)"

# ---------------------------------------------------------------- deps -------
if [[ ! -d node_modules || ! -d node_modules/playwright ]]; then
  say "installing dependencies"
  bun install
fi
[[ -d node_modules/playwright ]] \
  || die "playwright is still missing after bun install" \
         "check package.json devDependencies, then: bun install --force"

# Chromium is a separate download from the npm package. Idempotent; a no-op once
# present. Without it the browser host silently disappears.
say "ensuring chromium for the browser host"
bunx playwright install chromium

# ----------------------------------------------------------------- runtime ---
if [[ "$MODE" == "published" ]]; then
  say "runtime: PUBLISHED release (wasm.deka.gg / releases.deka.gg)"
  unset DEKA_NATIVE DEKA_WASM || true
else
  if [[ -z "$DEKA_REPO" ]]; then
    for candidate in ../deka "$HOME/Projects/deka" "$HOME/src/deka"; do
      [[ -f "$candidate/crates/cli/Cargo.toml" ]] && DEKA_REPO="$candidate" && break
    done
  fi
  [[ -n "$DEKA_REPO" ]] \
    || die "no deka checkout given or found (looked in ../deka, ~/Projects/deka, ~/src/deka)" \
           "./run.sh /path/to/deka   (or set DEKA_REPO, or use --published)"

  # Resolve only after confirming it exists: a bare `cd` into a missing path
  # aborts under `set -e` with bash's own message instead of the remedy.
  [[ -d "$DEKA_REPO" ]] \
    || die "no such directory: $DEKA_REPO" \
           "check the path, or use ./run.sh --published"
  DEKA_REPO="$(cd "$DEKA_REPO" && pwd)"
  [[ -f "$DEKA_REPO/crates/cli/Cargo.toml" ]] \
    || die "$DEKA_REPO is not a deka checkout (no crates/cli/Cargo.toml)" \
           "point at the deka repo root"

  say "runtime: $DEKA_REPO ($(git -C "$DEKA_REPO" rev-parse --short HEAD 2>/dev/null || echo 'not a git checkout'))"

  command -v cargo >/dev/null 2>&1 \
    || die "cargo not found, needed to build the runtime" \
           "install rust from https://rustup.rs, or use ./run.sh --published"

  # The wasm target is a separate rustup component; its absence surfaces as a
  # confusing linker error rather than a missing-target message.
  if ! rustup target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown; then
    say "adding wasm32-unknown-unknown target"
    rustup target add wasm32-unknown-unknown
  fi

  # Build BOTH, every run. cargo is incremental so an up-to-date tree costs
  # seconds, and rebuilding is the only way to guarantee the two hosts came from
  # one source. The stale-binary failure is removed here rather than detected
  # later.
  say "building native CLI"
  ( cd "$DEKA_REPO" && cargo build --release -p cli )

  say "building wasm compiler"
  ( cd "$DEKA_REPO" && CARGO_INCREMENTAL=0 cargo build --release \
      --target wasm32-unknown-unknown -p deka_compiler_wasm --no-default-features )

  export DEKA_NATIVE="$DEKA_REPO/target/release/cli"
  export DEKA_WASM="$DEKA_REPO/target/wasm32-unknown-unknown/release/deka_compiler_wasm.wasm"

  [[ -x "$DEKA_NATIVE" ]] \
    || die "native CLI missing after a successful build: $DEKA_NATIVE" \
           "check CARGO_TARGET_DIR is not redirecting the build elsewhere"
  [[ -f "$DEKA_WASM" ]] \
    || die "wasm compiler missing after a successful build: $DEKA_WASM" \
           "check CARGO_TARGET_DIR is not redirecting the build elsewhere"
fi

# --------------------------------------------------------------------- run ---
# run-tests.mjs --run re-verifies all of the above independently. That is a
# backstop for anyone who bypasses this script, not a duplicate of it.
say "running the suite (native + browser)"
echo
set +e
bun "$SUITE_ROOT/scripts/run-tests.mjs" --run "${PASSTHRU[@]+"${PASSTHRU[@]}"}"
STATUS=$?
set -e

echo
case $STATUS in
  0) say "suite ran -- results above, full report in .cache/report.txt" ;;
  2) say "BLOCKED -- environment unfit to run; this is not a result for your runtime" ;;
  *) say "harness exited $STATUS" ;;
esac
exit $STATUS
