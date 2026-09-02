import fs from 'fs'
import path from 'path'
import { loadWasmCompiler, compileWithWasm, formatDsWithWasm, readCompilerMetadata } from './build-wasm'
import { nativeCliVersion, prepareNativeCli, runNativeCli } from './build-native'
import {
  closeBrowserHost,
  prepareBrowserHost,
  runCompiledJsInBrowser,
  runProjectInBrowser,
} from './run-browser'
import { setCompilerArtifactPath } from '@dekaruntime/web-ide-kit/runtime'
import { loadAllTests, type HatsCategory, type HatsHost, type HatsTest, type HatsTestStage } from './tests'
import { computeOverallStatus, type HatsOverallStatus } from './overall-status'

/** Summary the pack carries; the site renders it and never recomputes it. */
export interface HatsGroups {
  'native-only': { pass: number; fail: number; total: number }
  shared: { pass: number; fail: number; diverge: number; total: number }
  'browser-only': { pass: number; fail: number; total: number }
}

export { computeOverallStatus, type HatsOverallStatus } from './overall-status'

export type RuntimeStatus = 'pass' | 'fail'

export interface RuntimeResult {
  ok: boolean
  stage: HatsTestStage
  stdout: string
  stderr: string
  formattedCode?: string
  emittedJs?: string
  error?: string
  skipped?: boolean
  skipReason?: string
  diagnostics: Array<{
    severity: 'error' | 'warning' | 'info'
    message: string
    line?: number
    column?: number
  }>
}

export interface HatsTestWithBuildResult extends HatsTest {
  wasmResult: RuntimeResult
  nativeResult: RuntimeResult
  wasmMatches: boolean
  nativeMatches: boolean
  /** What actually happened. Prefer this (deka#368). */
  verdict?: HatsOverallStatus
  /** @deprecated ambiguous -- `status` is the fixture's EXPECTATION, this is
   *  the outcome. Kept while packs built before deka#533 are still served. */
  overallStatus: HatsOverallStatus
}

export interface HatsCategoryWithResults extends HatsCategory {
  tests: HatsTestWithBuildResult[]
}

function determineStage(
  ok: boolean,
  js?: string,
  error?: string,
  diagnostics?: RuntimeResult['diagnostics']
): HatsTestStage {
  if (ok) return 'run'
  if (error && error.length > 0 && (!js || js.length === 0)) return 'parse'
  const hasErrors = (diagnostics ?? []).some((d) => d.severity === 'error')
  if (hasErrors) return !js || js.length === 0 ? 'parse' : 'typecheck'
  return 'parse'
}

function exactMatch(actual: string, expected: string): boolean {
  return actual === expected
}

function expectedStdoutForHost(test: HatsTest, host: HatsHost): string | undefined {
  if (host === 'native' && test.expectedStdoutNative !== undefined) {
    return test.expectedStdoutNative
  }
  if (host === 'browser' && test.expectedStdoutBrowser !== undefined) {
    return test.expectedStdoutBrowser
  }
  return test.expectedStdout
}

function runtimeMatchesExpectation(
  test: HatsTest,
  result: RuntimeResult,
  host: HatsHost,
  options: { ignoreCode?: boolean } = {}
): boolean {
  if (result.skipped) return false
  if ((result.ok ? 'pass' : 'fail') !== test.status) return false
  if (result.stage !== test.stage) return false

  const expectedStdout = expectedStdoutForHost(test, host)
  if (expectedStdout !== undefined) {
    if (!exactMatch(result.stdout, expectedStdout)) return false
  }

  if (!options.ignoreCode && test.expectedCode !== undefined) {
    if (!exactMatch(result.formattedCode ?? '', test.expectedCode)) return false
  }

  if (test.expectedDiagnosticContains) {
    const hasDiagnostic = result.diagnostics.some((d) =>
      d.message.toLowerCase().includes(test.expectedDiagnosticContains!.toLowerCase())
    )
    if (!hasDiagnostic) return false
  }

  return true
}

function skippedResult(reason: string): RuntimeResult {
  return {
    ok: false,
    stage: 'run',
    stdout: '',
    stderr: '',
    skipped: true,
    skipReason: reason,
    diagnostics: [],
  }
}

async function runBrowserTest(
  source: string,
  slug: string,
  files?: Record<string, string>,
  entryPath?: string
): Promise<RuntimeResult> {
  const formatResult = formatDsWithWasm(globalHatsCompiler, source)
  const formattedCode = formatResult.ok ? formatResult.code : undefined
  const isProject = Boolean(files && entryPath)

  if (isProject) {
    const projectFiles = { [entryPath!]: source, ...files }
    const runResult = await runProjectInBrowser(entryPath!, projectFiles)
    return { ...runResult, formattedCode }
  }

  const compileResult = compileWithWasm(globalHatsCompiler, source, `${slug}.ds`)
  if (!compileResult.ok || !compileResult.js) {
    return {
      ok: false,
      stage: determineStage(false, compileResult.js, compileResult.error, compileResult.diagnostics),
      stdout: '',
      stderr: '',
      formattedCode,
      error: compileResult.error,
      diagnostics: compileResult.diagnostics,
    }
  }

  const runResult = await runCompiledJsInBrowser(compileResult.js)
  const diagnostics = compileResult.diagnostics.slice()
  if (!runResult.ok && runResult.error) {
    diagnostics.push({ severity: 'error', message: runResult.error })
  }
  return {
    ...runResult,
    formattedCode,
    emittedJs: compileResult.js,
    diagnostics,
  }
}

async function runNativeTest(
  cliPath: string,
  source: string,
  files?: Record<string, string>,
  entryPath?: string,
  dekaJson?: Record<string, unknown>,
  packages?: string[]
): Promise<RuntimeResult> {
  const nativeResult = await runNativeCli(cliPath, source, entryPath, files, { dekaJson, packages })
  const stage: HatsTestStage = nativeResult.ok
    ? 'run'
    : nativeResult.transpileFailed
      ? 'parse'
      : 'run'

  return {
    ok: nativeResult.ok,
    stage,
    stdout: nativeResult.stdout,
    stderr: nativeResult.stderr,
    error: nativeResult.error,
    emittedJs: nativeResult.emittedJs,
    diagnostics: nativeResult.diagnostics,
  }
}

let globalHatsCompiler: Awaited<ReturnType<typeof loadWasmCompiler>>
let loadAndRunPromise: Promise<HatsBuildResults> | null = null

export interface HatsBuildResults {
  nativeAvailable: boolean
  browserAvailable: boolean
  version: string
  wasmSourceCommit?: string
  groups?: HatsGroups
  /** Latest released version, for staleness. null when undeterminable. */
  latestVersion?: string | null
  categories: HatsCategoryWithResults[]
}

const WASM_COMPILER_MANIFEST_URL = 'https://wasm.deka.gg/latest/deka-compiler-artifact.json'

async function runAllTestsOnce(): Promise<HatsBuildResults> {
  setCompilerArtifactPath(WASM_COMPILER_MANIFEST_URL)
  globalHatsCompiler = await loadWasmCompiler()
  const wasmMeta = readCompilerMetadata(globalHatsCompiler)
  const version = wasmMeta.version
  const origin = process.env.DEKA_WASM ? 'local bytes' : 'loaded artifact'
  console.log(
    `[hats build] wasm compiler version=${version} source_commit=${wasmMeta.source_commit}` +
      ` (${origin}, from deka_compiler_metadata)`
  )
  const nativeCliPath = await prepareNativeCli(version)
  const nativeAvailable = nativeCliPath !== null
  if (nativeCliPath) {
    const reported = nativeCliVersion(nativeCliPath)
    if (reported && reported !== version) {
      throw new Error(
        `host pairing mismatch: native CLI is ${reported} but wasm ` +
          `deka_compiler_metadata() is ${version} (${wasmMeta.source_commit}). ` +
          `Point DEKA_NATIVE and DEKA_WASM at the same build.`
      )
    }
  }
  const browserAvailable = await prepareBrowserHost()
  console.log(`[hats build] nativeAvailable=${nativeAvailable} browserAvailable=${browserAvailable}`)

  const categories = loadAllTests()
  const results: HatsCategoryWithResults[] = []

  try {
    for (const category of categories) {
      const tests: HatsTestWithBuildResult[] = []
      const filter = process.env.HATS_FILTER
      for (const test of category.tests) {
        if (filter && !test.slug.includes(filter)) continue
        const wantNative = test.hosts.includes('native')
        const wantBrowser = test.hosts.includes('browser')

        const wasmResult =
          wantBrowser && browserAvailable
            ? await runBrowserTest(test.source, test.slug, test.files, test.entryPath)
            : skippedResult(
                !wantBrowser
                  ? 'fixture is not a browser host test'
                  : 'browser host unavailable'
              )

        const nativeResult =
          wantNative && nativeCliPath
            ? await runNativeTest(
                nativeCliPath,
                test.source,
                test.files,
                test.entryPath,
                test.dekaJson,
                test.packages
              )
            : skippedResult(
                !wantNative
                  ? 'fixture is not a native host test'
                  : 'native CLI unavailable'
              )

        const wasmMatches =
          !wasmResult.skipped &&
          runtimeMatchesExpectation(test, wasmResult, 'browser')
        const nativeMatches =
          !nativeResult.skipped &&
          runtimeMatchesExpectation(test, nativeResult, 'native', { ignoreCode: true })

        tests.push({
          ...test,
          wasmResult,
          nativeResult,
          wasmMatches,
          nativeMatches,
          overallStatus: computeOverallStatus({
            wantNative,
            wantBrowser,
            nativeAvailable,
            browserAvailable,
            nativeMatches,
            browserMatches: wasmMatches,
            nativeSkipped: Boolean(nativeResult.skipped),
            browserSkipped: Boolean(wasmResult.skipped),
          }),
        })
      }
      results.push({ ...category, tests })
    }
  } finally {
    await closeBrowserHost()
  }

  return {
    nativeAvailable,
    browserAvailable,
    version,
    wasmSourceCommit: wasmMeta.source_commit,
    categories: results,
  }
}

export async function loadAndRunAllTests(): Promise<HatsBuildResults> {
  if (!loadAndRunPromise) {
    loadAndRunPromise = runAllTestsOnce()
  }
  return loadAndRunPromise
}

/**
 * Load pre-computed conformance results from `public/hats-results.json`.
 * That file is filled in by `scripts/ingest.mjs` from the deka pack. This
 * repo does not re-run the suite.
 */
/**
 * The version currently released, or null if it cannot be determined.
 *
 * Build-time only, and a failure here must never fail the build -- the page
 * degrades to showing the pack's version with no staleness note, which is
 * exactly what it did before deka#368.
 */
async function latestReleasedVersion(): Promise<string | null> {
  try {
    const res = await fetch('https://releases.deka.gg/latest.json', {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { version?: string }
    return json.version ?? null
  } catch {
    return null
  }
}

export async function loadBuildResults(): Promise<HatsBuildResults> {
  const resultsPath = path.join(process.cwd(), 'public', 'hats-results.json')
  if (!fs.existsSync(resultsPath)) {
    throw new Error(
      'public/hats-results.json is missing. Run `bun scripts/ingest.mjs` (deka#292).'
    )
  }
  const raw = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'))
  return {
    nativeAvailable: Boolean(raw.nativeAvailable),
    browserAvailable: raw.browserAvailable !== false,
    version: raw.version ?? 'unknown',
    wasmSourceCommit: raw.wasmSourceCommit,
    // The pack owns the summary. The site renders it and never recomputes it --
    // one producer owns every number (deka#503, TESTING.md).
    groups: raw.groups,
    // deka#368: a pack three releases old renders identically to a current
    // one unless the page is told. Sami's rule is that the site must never
    // show a previous run's metrics as if they were current.
    latestVersion: await latestReleasedVersion(),
    categories: raw.categories,
  }
}
