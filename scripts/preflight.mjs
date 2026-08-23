// Environment preflight for the conformance gate.
//
// The gate exists because a broken environment does not look broken. A missing
// dev dependency drops the browser host and the suite still prints a healthy
// summary with zero divergences; a stale native binary paired against a current
// wasm turns type-name drift into what looks like native/browser disagreement.
// Both failures are silent, plausible, and produce a number you would quote.
//
// So preflight asserts what the run depends on BEFORE the run, and every check
// returns a fact rather than a boolean, so the report can show its work.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

/** @typedef {{ name: string, ok: boolean, detail: string, fatal: boolean }} Check */

function check(name, ok, detail, fatal = true) {
  return { name, ok, detail, fatal }
}

/**
 * Walk up from an artifact inside `target/` to the cargo workspace root.
 * Returns undefined when the artifact does not live under a recognisable repo,
 * which is normal for a downloaded published CLI.
 */
function repoRootFor(artifactPath) {
  let dir = dirname(resolve(artifactPath))
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'Cargo.toml')) && existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/**
 * deka has no [workspace.package] block - each crate carries its own version.
 * The binary under test is the `cli` crate, so that is the version to compare
 * against. Do NOT use the published CDN manifest for this: v0.26.1 was tagged
 * on a tree whose cli crate says 0.26.0, so the published label and the source
 * tree genuinely disagree.
 */
function cliCrateVersion(repoRoot) {
  try {
    const toml = readFileSync(join(repoRoot, 'crates', 'cli', 'Cargo.toml'), 'utf8')
    return toml.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
  } catch {
    return undefined
  }
}

function gitHead(repoRoot) {
  try {
    return execFileSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return 'unknown'
  }
}

function nativeVersion(cliPath) {
  // `deka [version 0.26.0]` - written to stderr, not stdout, alongside an
  // update nag. Capture both streams or the version silently reads as unknown.
  const r = spawnSync(cliPath, ['--version'], { encoding: 'utf8', timeout: 30_000 })
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.match(/(\d+\.\d+\.\d+)/)?.[1]
}

export function preflight() {
  /** @type {Check[]} */
  const checks = []
  const facts = {}

  const nativeEnv = process.env.DEKA_NATIVE
  const wasmEnv = process.env.DEKA_WASM
  facts.mode = nativeEnv || wasmEnv ? 'local' : 'published'

  // --- both-or-neither -----------------------------------------------------
  // Pairing one local host against one published host is the failure RFD 26
  // calls out by name: it renders type-name drift as host divergence.
  checks.push(
    check(
      'host pairing',
      Boolean(nativeEnv) === Boolean(wasmEnv),
      nativeEnv || wasmEnv
        ? `DEKA_NATIVE=${nativeEnv ?? '(unset)'} DEKA_WASM=${wasmEnv ?? '(unset)'}`
        : 'both unset - grading the published release'
    )
  )

  // --- artifacts exist -----------------------------------------------------
  for (const [label, value] of [
    ['DEKA_NATIVE', nativeEnv],
    ['DEKA_WASM', wasmEnv],
  ]) {
    if (!value) continue
    const resolved = resolve(value)
    const ok = existsSync(resolved)
    facts[label] = resolved
    checks.push(
      check(
        `${label} exists`,
        ok,
        ok ? `${resolved} (${statSync(resolved).mtime.toISOString()})` : `missing: ${resolved}`
      )
    )
  }

  // --- version match -------------------------------------------------------
  // The wasm artifact exports no version function, so it cannot self-report.
  // The checkout that produced both artifacts can, and a native binary whose
  // version trails its own tree is a stale build - the case that silently
  // produced 8 phantom divergences.
  if (nativeEnv && existsSync(resolve(nativeEnv))) {
    const cli = resolve(nativeEnv)
    const repoRoot = repoRootFor(wasmEnv ? resolve(wasmEnv) : cli) ?? repoRootFor(cli)
    let native
    try {
      native = nativeVersion(cli)
    } catch (err) {
      checks.push(check('native --version', false, `could not run ${cli}: ${String(err)}`))
    }
    facts.nativeVersion = native ?? 'unknown'

    if (repoRoot) {
      const tree = cliCrateVersion(repoRoot)
      facts.repoRoot = repoRoot
      facts.repoVersion = tree ?? 'unknown'
      facts.repoHead = gitHead(repoRoot)
      checks.push(
        check(
          'native matches its tree',
          Boolean(native && tree && native === tree),
          native === tree
            ? `${native} == workspace ${tree} @ ${facts.repoHead}`
            : `native CLI is ${native} but ${repoRoot} is ${tree} @ ${facts.repoHead}` +
                ' - stale binary, rebuild: cargo build --release -p cli'
        )
      )
    } else {
      checks.push(
        check(
          'native matches its tree',
          true,
          `no cargo checkout above ${cli} - cannot verify, treating as published`,
          false
        )
      )
    }
  }

  // --- browser host --------------------------------------------------------
  // Not fatal here: build-tests reports browserAvailable authoritatively after
  // it tries to launch. This check exists to fail fast with a fixable message
  // instead of a 3-minute native-only run that looks fine.
  let playwrightOk = false
  let playwrightDetail = ''
  try {
    const req = createRequire(import.meta.url)
    playwrightDetail = req.resolve('playwright')
    playwrightOk = true
  } catch (err) {
    playwrightDetail = `not resolvable - run: bun install (${String(err).split('\n')[0]})`
  }
  checks.push(check('playwright installed', playwrightOk, playwrightDetail))

  return { checks, facts }
}

export function formatPreflight({ checks, facts }) {
  const lines = ['Preflight', '---------']
  for (const c of checks) {
    lines.push(`  ${c.ok ? 'ok  ' : c.fatal ? 'FAIL' : 'warn'}  ${c.name}: ${c.detail}`)
  }
  lines.push('')
  lines.push(`  mode: ${facts.mode}`)
  return lines.join('\n')
}

export function preflightFatal({ checks }) {
  return checks.some((c) => !c.ok && c.fatal)
}
