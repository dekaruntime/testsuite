import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAndRunAllTests } from '../lib/build-tests.ts'
import { formatPreflight, preflight, preflightFatal } from './preflight.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_PATH = join(ROOT, '.cache', 'report.txt')

async function main() {
  const args = process.argv.slice(2)
  const categoryIdx = args.indexOf('--category')
  const categoryFilter = categoryIdx !== -1 ? args[categoryIdx + 1] : undefined
  const listMode = args.includes('--list')

  // --run is what run.sh uses: verify the environment, require both hosts, and
  // write a report. It reports on the runtime it was pointed at; it does not
  // compare the results to anything.
  const runMode = args.includes('--run')

  // Preflight first. Every check is cheap, and every failure it catches would
  // otherwise cost a full suite run and produce a plausible wrong answer.
  const pre = runMode ? preflight() : undefined
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

  // A host that did not run cannot report anything. Native-only shows zero
  // divergences no matter what the browser compiler does, and that run looks
  // healthier than a correct one -- so refuse rather than publish half a result.
  if (runMode && !(results.nativeAvailable && results.browserAvailable)) {
    console.error(
      `\nRefusing to report: nativeAvailable=${results.nativeAvailable}` +
        ` browserAvailable=${results.browserAvailable}.` +
        '\nBoth hosts must run. For the browser host: bunx playwright install chromium'
    )
    process.exit(2)
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
    console.log(`Hosts: native=${results.nativeAvailable} browser=${results.browserAvailable}`)
  }
  console.log(`Elapsed: ${elapsed}s`)

  const notPassing = []
  for (const category of categories) {
    for (const test of category.tests) {
      if (test.overallStatus === 'pass') continue
      const line = `${test.category}/${test.name}: expected ${test.status} at ${test.stage}, got ${test.overallStatus}`
      const detail = []
      if (test.wasmResult.error) detail.push(`    browser: ${test.wasmResult.error.split('\n')[0]}`)
      if (test.nativeResult.error) detail.push(`    native:  ${test.nativeResult.error.split('\n')[0]}`)
      notPassing.push({ line, detail })
    }
  }

  if (notPassing.length > 0) {
    console.log('\nNot passing:')
    for (const { line, detail } of notPassing) {
      console.log(`  ${line}`)
      for (const d of detail) console.log(d)
    }
  }

  if (runMode) {
    const report = [
      `deka test suite - ${new Date().toISOString()}`,
      '',
      pre ? formatPreflight(pre) : '',
      `hosts: native=${results.nativeAvailable} browser=${results.browserAvailable}`,
      `totals: pass ${overallPass} | fail ${overallFail} | divergent ${overallDivergent}`,
      `elapsed: ${elapsed}s`,
      '',
      `not passing: ${notPassing.length}`,
      ...notPassing.flatMap(({ line, detail }) => [`  ${line}`, ...detail]),
      '',
    ].join('\n')

    mkdirSync(dirname(REPORT_PATH), { recursive: true })
    writeFileSync(REPORT_PATH, report)
    console.log(`\nReport: ${REPORT_PATH}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
