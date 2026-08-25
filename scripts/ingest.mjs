#!/usr/bin/env bun
// Fill in the Hats tree + dump produced by deka. Does not re-run 620 tests.
// See deka#292.
import { mkdirSync, rmSync, existsSync, cpSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_PACK = 'https://wasm.deka.gg/latest/conformance/manifest.json'
const packUrl = process.env.DEKA_CONFORMANCE_MANIFEST || DEFAULT_PACK
const dekaRepo = process.env.DEKA_REPO || ''

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) {
    const err = new Error(`GET ${url} -> ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

async function fetchBytes(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

function copyTree(from, to) {
  rmSync(to, { recursive: true, force: true })
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
}

async function ingestFromPack(manifestUrl) {
  const manifest = await fetchJson(manifestUrl)
  const base = new URL('./', manifestUrl).toString()
  console.log(`[ingest] pack version=${manifest.version} commit=${manifest.commit} from ${manifestUrl}`)

  const testsOut = join(ROOT, 'tests')
  rmSync(testsOut, { recursive: true, force: true })
  mkdirSync(testsOut, { recursive: true })

  // Download is a directory tree; the pack is published as individual objects
  // under testsuite/<category>/... Listing via manifest only gives prefixes.
  // The pack also includes hats-results.json which embeds sources. We still
  // fetch the tree from the GitHub-published layout: each category is a prefix
  // we expand by using the dump's categories if the tree listing is not
  // available. Simpler: the pack is synced as a prefix; we pull hats-results
  // and reconstruct tests/ from the dump records (source + extra files).
  const resultsUrl = new URL(manifest.results || 'hats-results.json', base).toString()
  const results = await fetchJson(resultsUrl)
  writeFileSync(join(ROOT, 'public', 'hats-results.json'), JSON.stringify(results) + '\n')
  console.log(`[ingest] wrote public/hats-results.json (${results.categories?.length ?? 0} categories)`)

  for (const category of results.categories ?? []) {
    for (const test of category.tests ?? []) {
      const dir = join(testsOut, test.category, test.name)
      mkdirSync(dir, { recursive: true })
      const entry = test.entryPath || `${test.name}.${test.status}.ds`
      writeFileSync(join(dir, entry), test.source ?? '')
      if (test.files) {
        for (const [rel, content] of Object.entries(test.files)) {
          const full = join(dir, rel)
          mkdirSync(dirname(full), { recursive: true })
          writeFileSync(full, content)
        }
      }
      const meta = {
        title: test.title,
        stage: test.stage,
        hosts: test.hosts,
        expectedDiagnosticContains: test.expectedDiagnosticContains,
        packages: test.packages,
        notes: test.notes,
      }
      const metaName = entry.replace(/\.(pass|fail)\.ds$/, '.json')
      writeFileSync(join(dir, metaName), JSON.stringify(meta, null, 2) + '\n')
      if (typeof test.expectedStdout === 'string') {
        writeFileSync(join(dir, entry.replace(/\.(pass|fail)\.ds$/, '.stdout')), test.expectedStdout)
      }
      if (typeof test.expectedCode === 'string') {
        writeFileSync(join(dir, entry.replace(/\.(pass|fail)\.ds$/, '.code')), test.expectedCode)
      }
    }
  }
  console.log(`[ingest] reconstructed tests/ from dump`)
}

function ingestFromDekaCheckout(repo) {
  const src = join(repo, 'tests', 'testsuite')
  if (!existsSync(src)) {
    throw new Error(`${src} does not exist`)
  }
  copyTree(src, join(ROOT, 'tests'))
  console.log(`[ingest] copied Hats tree from ${src}`)
  const dump = process.env.DEKA_DUMP_OUT || join(repo, 'dist', 'conformance', 'hats-results.json')
  if (existsSync(dump)) {
    mkdirSync(join(ROOT, 'public'), { recursive: true })
    cpSync(dump, join(ROOT, 'public', 'hats-results.json'))
    console.log(`[ingest] copied dump from ${dump}`)
  } else if (!existsSync(join(ROOT, 'public', 'hats-results.json'))) {
    throw new Error(
      `no hats-results.json. Run the deka dump (tests/dump) or set DEKA_CONFORMANCE_MANIFEST.`
    )
  }
}

try {
  await ingestFromPack(packUrl)
} catch (error) {
  if (dekaRepo) {
    console.warn(`[ingest] pack unavailable (${error.message}); falling back to DEKA_REPO=${dekaRepo}`)
    ingestFromDekaCheckout(dekaRepo)
  } else if (error.status === 404) {
    const fallback = process.env.DEKA_DUMP_FALLBACK || 'https://testsuite.deka.gg/hats-results.json'
    console.warn(`[ingest] pack 404 at ${packUrl}; filling in from ${fallback}`)
    const results = await fetchJson(fallback)
    mkdirSync(join(ROOT, 'public'), { recursive: true })
    writeFileSync(join(ROOT, 'public', 'hats-results.json'), JSON.stringify(results) + '\n')
    // Reconstruct tests/ using the same dump records.
    const testsOut = join(ROOT, 'tests')
    rmSync(testsOut, { recursive: true, force: true })
    mkdirSync(testsOut, { recursive: true })
    for (const category of results.categories ?? []) {
      for (const test of category.tests ?? []) {
        const dir = join(testsOut, test.category, test.name)
        mkdirSync(dir, { recursive: true })
        const entry = test.entryPath || `${test.name}.${test.status}.ds`
        writeFileSync(join(dir, entry), test.source ?? '')
        if (test.files) {
          for (const [rel, content] of Object.entries(test.files)) {
            const full = join(dir, rel)
            mkdirSync(dirname(full), { recursive: true })
            writeFileSync(full, content)
          }
        }
      }
    }
    console.log(`[ingest] reconstructed tests/ from fallback dump`)
  } else {
    throw error
  }
}
