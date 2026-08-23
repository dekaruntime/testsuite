import fs from 'fs'
import path from 'path'
import { loadWasmCompiler, compileWithWasm, formatDsWithWasm } from './build-wasm'
import { prepareNativeCli, runNativeCli } from './build-native'
import {
  closeBrowserHost,
  prepareBrowserHost,
  runCompiledJsInBrowser,
  runProjectInBrowser,
} from './run-browser'
import { setCompilerArtifactPath } from '@dekaruntime/web-ide-kit/runtime'
import { loadAllTests, type HatsCategory, type HatsHost, type HatsTest, type HatsTestStage } from './tests'

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
  overallStatus: 'pass' | 'fail' | 'divergent'
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

function computeOverallStatus(args: {
  wantNative: boolean
  wantBrowser: boolean
  nativeAvailable: boolean
  browserAvailable: boolean
  nativeMatches: boolean
  browserMatches: boolean
  nativeSkipped: boolean
  browserSkipped: boolean
}): 'pass' | 'fail' | 'divergent' {
  const nativeRan = args.wantNative && args.nativeAvailable && !args.nativeSkipped
  const browserRan = args.wantBrowser && args.browserAvailable && !args.browserSkipped

  if (!nativeRan && !browserRan) return 'fail'

  const nativeOk = !nativeRan || args.nativeMatches
  const browserOk = !browserRan || args.browserMatches
  if (nativeOk && browserOk) return 'pass'
  if (nativeRan && browserRan && args.nativeMatches !== args.browserMatches) return 'divergent'
  return 'fail'
}

let globalHatsCompiler: Awaited<ReturnType<typeof loadWasmCompiler>>
let loadAndRunPromise: Promise<HatsBuildResults> | null = null

export interface HatsBuildResults {
  nativeAvailable: boolean
  browserAvailable: boolean
  version: string
  categories: HatsCategoryWithResults[]
}

const WASM_COMPILER_MANIFEST_URL = 'https://wasm.deka.gg/latest/deka-compiler-artifact.json'

async function runAllTestsOnce(): Promise<HatsBuildResults> {
  setCompilerArtifactPath(WASM_COMPILER_MANIFEST_URL)
  globalHatsCompiler = await loadWasmCompiler()
  const wasmManifest = (await (await fetch(WASM_COMPILER_MANIFEST_URL)).json()) as {
    compiler: { version: string }
  }
  // This version comes from the published CDN manifest, NOT from the compiler
  // that was just loaded. When DEKA_WASM overrides the artifact the two are
  // unrelated, and printing the published number next to the local path reads
  // as corroboration: a run pairing a stale native 0.25.7 against a local wasm
  // reported "version=0.26.1" throughout and produced 8 phantom divergences.
  // Say which one it is.
  const version = wasmManifest.compiler.version
  if (process.env.DEKA_WASM) {
    console.log(
      `[hats build] wasm compiler: LOCAL artifact, version unverified` +
        ` (published latest is ${version}; not a claim about this build)`
    )
  } else {
    console.log(`[hats build] wasm compiler version=${version} (published)`)
  }
  const nativeCliPath = await prepareNativeCli(version)
  const nativeAvailable = nativeCliPath !== null
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

  return { nativeAvailable, browserAvailable, version, categories: results }
}

export async function loadAndRunAllTests(): Promise<HatsBuildResults> {
  if (!loadAndRunPromise) {
    loadAndRunPromise = runAllTestsOnce()
  }
  return loadAndRunPromise
}

/**
 * Load pre-computed conformance results from `public/hats-results.json`.
 * Falls back to running the suite directly when the file is missing (e.g. local
 * `bun run dev` before the first dump).
 */
export async function loadBuildResults(): Promise<HatsBuildResults> {
  const resultsPath = path.join(process.cwd(), 'public', 'hats-results.json')
  if (fs.existsSync(resultsPath)) {
    const raw = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'))
    return {
      nativeAvailable: Boolean(raw.nativeAvailable),
      browserAvailable: raw.browserAvailable !== false,
      version: raw.version ?? 'unknown',
      categories: raw.categories,
    }
  }
  return loadAndRunAllTests()
}
