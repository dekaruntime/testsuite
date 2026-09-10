#!/usr/bin/env bun
// Fill in the Hats tree + dump produced by deka. Does not re-run 620 tests.
// See deka#292.
import { mkdirSync, writeFileSync } from 'node:fs'
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

async function ingestFromPack(manifestUrl) {
  const manifest = await fetchJson(manifestUrl)
  const base = new URL('./', manifestUrl).toString()
  console.log(`[ingest] pack version=${manifest.version} commit=${manifest.commit} from ${manifestUrl}`)

  // The pack supplies execution results only. Fixture source and expectations
  // are the tracked corpus in this repository, never a reconstructed copy of
  // a consumer checkout.
  const resultsUrl = new URL(manifest.results || 'hats-results.json', base).toString()
  const results = await fetchJson(resultsUrl)
  writeFileSync(join(ROOT, 'public', 'hats-results.json'), JSON.stringify(results) + '\n')
  console.log(`[ingest] wrote public/hats-results.json (${results.categories?.length ?? 0} categories)`)

}

try {
  await ingestFromPack(packUrl)
} catch (error) {
  if (dekaRepo) {
    throw new Error(`DEKA_REPO is no longer supported: fixtures are owned by ${ROOT}/corpus`)
  } else if (error.status === 404) {
    const fallback = process.env.DEKA_DUMP_FALLBACK || 'https://testsuite.deka.gg/hats-results.json'
    console.warn(`[ingest] pack 404 at ${packUrl}; filling in from ${fallback}`)
    const results = await fetchJson(fallback)
    mkdirSync(join(ROOT, 'public'), { recursive: true })
    writeFileSync(join(ROOT, 'public', 'hats-results.json'), JSON.stringify(results) + '\n')
    console.warn('[ingest] using cached result fallback; corpus remains local')
  } else {
    throw error
  }
}
