import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAndRunAllTests } from '../lib/build-tests.ts'
import { formatPreflight, preflight, preflightFatal } from './preflight.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = join(ROOT, 'tests', 'baseline.txt')
const REPORT_PATH = join(ROOT, '.cache', 'gate-report.txt')

function readBaseline() {
  try {
    return new Set(
      readFileSync(BASELINE_PATH, 'utf8')
        .split('\n')
        .map((line) => line.replace(/#.*$/, '').trim())
        .filter(Boolean)
    )
  } catch {
    return undefined
  }
}

async function main() {
  const args = process.argv.slice(2)
  const categoryIdx = args.indexOf('--category')
  const categoryFilter = categoryIdx !== -1 ? args[categoryIdx + 1] : undefined
  const listMode = args.includes('--list')
  const gate = args.includes('--gate')
  const checkBaseline = gate || args.includes('--check-baseline')
  const writeBaseline = args.includes('--write-baseline')

  // --gate is the pre-merge command: verify the environment, run both hosts,
  // compare against the baseline, and leave a report behind. Preflight runs
  // first because every check it makes is cheap and every failure it catches
  // would otherwise cost a full suite run and produce a plausible wrong answer.
  if (gate && categoryFilter) {
    console.error('--gate grades the whole suite; --category would compare a subset to a full baseline.')
    process.exit(2)
  }

  const pre = gate || writeBaseline ? preflight() : undefined
  if (pre) {
    console.log(formatPreflight(pre))
    if (preflightFatal(pre)) {
      console.error('Preflight failed. Fix the above before trusting a run.\n')
      process.exit(2)
    }
  }

  const start = Date.now()
  const results = await loadAndRunAllTests()
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  const categories = categoryFilter
    ? results.categories.filter((c) => c.name === categoryFilter)
    : results.categories

  if (listMode) {
    for (const category of categories) {
      console.log(category.name)
      for (const test of category.tests) {
        console.log(`  ${test.name} (${test.status} at ${test.stage}) [${test.overallStatus}]`)
      }
    }
    return
  }

  let overallPass = 0
  let overallFail = 0
  let overallDivergent = 0

  for (const category of categories) {
    let catPass = 0
    let catFail = 0
    let catDivergent = 0
    for (const test of category.tests) {
      if (test.overallStatus === 'pass') catPass++
      else if (test.overallStatus === 'fail') catFail++
      else catDivergent++
    }
    overallPass += catPass
    overallFail += catFail
    overallDivergent += catDivergent
    console.log(
      `${category.name.padEnd(24)} | pass ${String(catPass).padStart(3)} | fail ${String(catFail).padStart(3)} | divergent ${String(catDivergent).padStart(3)}`
    )
  }

  if (!categoryFilter) {
    console.log('-'.repeat(60))
    console.log(
      `${'TOTAL'.padEnd(24)} | pass ${String(overallPass).padStart(3)} | fail ${String(overallFail).padStart(3)} | divergent ${String(overallDivergent).padStart(3)}`
    )
    console.log(`Native available: ${results.nativeAvailable}`)
  }
  console.log(`Elapsed: ${elapsed}s`)

  // List failures/divergences
  let hasIssues = false
  for (const category of categories) {
    for (const test of category.tests) {
      if (test.overallStatus !== 'pass') {
        if (!hasIssues) {
          console.log('\nFailures/divergences:')
          hasIssues = true
        }
        console.log(
          `  ${test.category}/${test.name}: expected ${test.status} at ${test.stage}, got ${test.overallStatus}`
        )
        if (test.wasmResult.error) {
          console.log(`    wasm: ${test.wasmResult.error.split('\n')[0]}`)
        }
        if (test.nativeResult.error) {
          console.log(`    native: ${test.nativeResult.error.split('\n')[0]}`)
        }
      }
    }
  }

  // A host that did not run cannot be graded. Native-only reports zero
  // divergences no matter what the browser compiler does, so comparing that
  // against a two-host baseline would silently pass browser regressions.
  if ((gate || writeBaseline) && !(results.nativeAvailable && results.browserAvailable)) {
    console.error(
      `\nRefusing to grade: nativeAvailable=${results.nativeAvailable}` +
        ` browserAvailable=${results.browserAvailable}.` +
        '\nBoth hosts must run. For the browser host: bunx playwright install chromium'
    )
    process.exit(2)
  }

  if (!checkBaseline && !writeBaseline) return

  // Baseline comparison always runs over every category, never the --category
  // subset: a gate that only sees part of the suite is not a gate.
  const failing = results.categories
    .flatMap((category) => category.tests)
    .filter((test) => test.overallStatus !== 'pass')
    .map((test) => `${test.category}/${test.name}`)
    .sort()

  if (writeBaseline) {
    const header = readFileSync(BASELINE_PATH, 'utf8').match(/^(#[^\n]*\n)+/)?.[0] ?? ''
    writeFileSync(BASELINE_PATH, header + failing.join('\n') + '\n')
    console.log(`\nBaseline rewritten: ${failing.length} known failures.`)
    return
  }

  const baseline = readBaseline()
  if (!baseline) {
    console.error(`\nNo baseline at ${BASELINE_PATH}. Run with --write-baseline first.`)
    process.exit(1)
  }

  const current = new Set(failing)
  const regressions = failing.filter((id) => !baseline.has(id))
  const fixed = [...baseline].filter((id) => !current.has(id)).sort()

  if (gate) {
    const divergent = results.categories
      .flatMap((c) => c.tests)
      .filter((t) => t.overallStatus === 'divergent')
      .map((t) => `${t.category}/${t.name}`)
      .sort()

    const report = [
      `deka conformance gate - ${new Date().toISOString()}`,
      '',
      pre ? formatPreflight(pre) : '',
      `hosts: native=${results.nativeAvailable} browser=${results.browserAvailable}`,
      `totals: pass ${overallPass} | fail ${overallFail} | divergent ${overallDivergent}`,
      `elapsed: ${elapsed}s`,
      '',
      `NEW (not in baseline): ${regressions.length}`,
      ...regressions.map((id) => `  - ${id}`),
      '',
      `now passing (baseline can tighten): ${fixed.length}`,
      ...fixed.map((id) => `  + ${id}`),
      '',
      `divergent, native vs browser: ${divergent.length}`,
      ...divergent.map((id) => `  ~ ${id}`),
      '',
    ].join('\n')

    mkdirSync(dirname(REPORT_PATH), { recursive: true })
    writeFileSync(REPORT_PATH, report)
    console.log(`\nReport: ${REPORT_PATH}`)
  }

  if (fixed.length > 0) {
    console.log(`\n${fixed.length} baselined fixture(s) now pass:`)
    for (const id of fixed) console.log(`  + ${id}`)
    console.log('Tighten the baseline: bun scripts/run-tests.mjs --write-baseline')
  }

  if (regressions.length === 0) {
    console.log(`\nBaseline OK: no new failures (${failing.length} known).`)
    return
  }

  console.error(`\n${regressions.length} NEW failure(s) not in the baseline:`)
  for (const id of regressions) console.error(`  - ${id}`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
