import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadWasmCompiler, compileWithWasm, formatDsWithWasm } from '../lib/build-wasm.ts'
import { prepareNativeCli, runNativeCli } from '../lib/build-native.ts'
import { loadAllTests } from '../lib/tests.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testsDir = path.join(__dirname, '..', 'tests')

const filters = process.argv.slice(2)

function slugMatches(slug) {
  if (filters.length === 0) return true
  return filters.some((f) => slug.includes(f))
}

const compiler = await loadWasmCompiler()
const wasmManifest = await (await fetch('https://wasm.deka.gg/latest/deka-compiler-artifact.json')).json()
const nativeCliPath = await prepareNativeCli(wasmManifest.compiler.version)
const skipped = []

function readJson(testDir, name) {
  const p = path.join(testDir, `${name}.json`)
  if (!fs.existsSync(p)) return {}
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

function writeJson(testDir, name, meta) {
  fs.writeFileSync(path.join(testDir, `${name}.json`), JSON.stringify(meta, null, 2) + '\n')
}

for (const category of loadAllTests()) {
  for (const test of category.tests) {
    if (!slugMatches(test.slug)) continue

    const testDir = path.join(testsDir, test.category, test.name)
    const baseName = test.name

    // Use the entry the loader already resolved. Multi-file tests (the whole
    // `modules` category) have an entry named main.pass.ds rather than
    // <dirname>.pass.ds. Constructing the filename from the directory name
    // used to throw there, so every category sorting after `modules`
    // (parser, types, unsafe, ...) was silently never regenerated.
    const source = test.source
    if (source === undefined) {
      console.log(`[regen] ${test.slug}: SKIPPED, no source on loaded test`)
      skipped.push(test.slug)
      continue
    }

    const compileResult = compileWithWasm(compiler, source, test.entryPath ?? `${baseName}.ds`)
    const formatResult = formatDsWithWasm(compiler, source)

    const meta = readJson(testDir, baseName)
    meta.title = meta.title || baseName.replace(/_/g, ' ')

    if (test.status === 'pass') {
      if (!compileResult.ok || !compileResult.js) {
        console.log(`[regen] ${test.slug}: PASS test failed to compile: ${compileResult.error}`)
        meta.stage = 'parse'
        if (compileResult.error) {
          meta.expectedDiagnosticContains = compileResult.error
        }
        writeJson(testDir, baseName, meta)
        continue
      }

      if (!nativeCliPath) {
        console.log(`[regen] ${test.slug}: SKIPPED runtime snapshot, native CLI unavailable`)
        skipped.push(test.slug)
        writeJson(testDir, baseName, meta)
        continue
      }

      const runResult = await runNativeCli(
        nativeCliPath,
        source,
        test.entryPath,
        test.files,
        { dekaJson: test.dekaJson }
      )
      if (!runResult.ok) {
        console.log(`[regen] ${test.slug}: PASS test failed at runtime: ${runResult.error}`)
        meta.stage = 'run'
        if (runResult.error) {
          meta.expectedDiagnosticContains = runResult.error
        }
        writeJson(testDir, baseName, meta)
        continue
      }

      fs.writeFileSync(path.join(testDir, `${baseName}.stdout`), runResult.stdout)
      if (formatResult.ok && formatResult.code) {
        fs.writeFileSync(path.join(testDir, `${baseName}.code`), formatResult.code)
      }
      delete meta.expectedDiagnosticContains
      meta.stage = 'run'
      console.log(`[regen] ${test.slug}: stdout+code updated`)
    } else {
      const firstError = compileResult.diagnostics.find((d) => d.severity === 'error')
      if (firstError) {
        meta.expectedDiagnosticContains = firstError.message
        meta.stage = 'parse'
      } else if (compileResult.error) {
        meta.expectedDiagnosticContains = compileResult.error
        meta.stage = 'parse'
      }
      console.log(`[regen] ${test.slug}: diagnostic updated`)
    }

    writeJson(testDir, baseName, meta)
  }
}

if (skipped.length > 0) {
  console.log(`\n[regen] ${skipped.length} test(s) skipped: ${skipped.join(', ')}`)
}
