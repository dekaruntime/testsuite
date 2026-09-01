'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { HatsCategoryWithResults, HatsTestWithBuildResult } from '@/lib/build-tests'
import type { HatsOverallStatus } from '@/lib/overall-status'
import type { HatsHost } from '@/lib/tests'
import { isRecordedOnly } from '@/lib/recorded-only'

interface HatsGridProps {
  categories: HatsCategoryWithResults[]
  nativeAvailable: boolean
  browserAvailable?: boolean
  version: string
}

export function statusColor(status: HatsOverallStatus): string {
  switch (status) {
    case 'pass':
      return 'bg-green-500'
    case 'divergent':
      return 'bg-pink-500'
    case 'fail':
      return 'bg-red-500'
    case 'skip':
      return 'bg-zinc-400'
  }
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function testMatches(query: string, test: HatsTestWithBuildResult): boolean {
  if (query === '') return true
  return (
    test.title.toLowerCase().includes(query) ||
    test.slug.toLowerCase().includes(query) ||
    test.category.toLowerCase().includes(query)
  )
}

export function HatsGrid({ categories, nativeAvailable, browserAvailable = true, version }: HatsGridProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = normalizeSearch(query)

  const filteredCategories = useMemo(() => {
    if (normalizedQuery === '') return categories
    return categories
      .map((group) => ({
        ...group,
        tests: group.tests.filter((test) => testMatches(normalizedQuery, test)),
      }))
      .filter((group) => group.tests.length > 0)
  }, [categories, normalizedQuery])

  const allTests = useMemo(() => categories.flatMap((c) => c.tests), [categories])
  const total = allTests.length

  // Report each host on its own terms. The previous single line collapsed
  // native and wasm into one pass/fail/drift triple, which made a formatter
  // difference on a test both hosts got right look identical to a genuine
  // compiler divergence -- and hid the native result entirely.
  const stats = useMemo(() => {
    const declares = (t: (typeof allTests)[number], host: HatsHost) =>
      (t.hosts ?? []).includes(host)

    const nativeRun = allTests.filter((t) => declares(t, 'native'))
    const nativePassing = nativeRun.filter((t) => t.nativeMatches).length

    const wasmRun = allTests.filter((t) => declares(t, 'browser'))
    const wasmPassing = wasmRun.filter((t) => t.wasmMatches).length

    // Drift is only meaningful where a test declares BOTH hosts: it is the
    // count of tests the two runtimes disagree about.
    const dual = allTests.filter((t) => declares(t, 'native') && declares(t, 'browser'))
    const drift = dual.filter((t) => t.nativeMatches !== t.wasmMatches).length

    return {
      native: {
        passing: nativePassing,
        failing: nativeRun.length - nativePassing,
        skipped: total - nativeRun.length,
      },
      wasm: {
        passing: wasmPassing,
        failing: wasmRun.length - wasmPassing,
        drift,
      },
    }
  }, [allTests, total])

  const visibleCount = filteredCategories.flatMap((c) => c.tests).length

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <img
            src="/deka-logo.png"
            alt="deka"
            className="h-6 w-auto"
          />
          <h1 className="text-xl font-bold">deka test suite</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs text-muted-foreground">
            <p>
              <a
                href="https://deka.gg/install"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                deka v{version}
              </a>
              {!nativeAvailable && (
                <span className="ml-2 text-amber-500">native runtime unavailable</span>
              )}
              {!browserAvailable && (
                <span className="ml-2 text-amber-500">browser runtime unavailable</span>
              )}
            </p>
            <p className="tabular-nums">
              <span className="font-medium text-foreground">native:</span>{' '}
              {stats.native.passing} passing · {stats.native.failing} failing ·{' '}
              {stats.native.skipped} skipped · {total} tests
            </p>
            <p className="tabular-nums">
              <span className="font-medium text-foreground">wasm:</span>{' '}
              {stats.wasm.passing} passing · {stats.wasm.failing} failing ·{' '}
              {stats.wasm.drift} drift · {total} tests
            </p>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter tests…"
            className="w-48 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
          />
        </div>
      </header>

      <main className="flex-1 p-6">
        <p className="mb-3 text-xs text-muted-foreground">
          Squares are dump-time results, not a live run. Open a case to tinker in the browser.
          Native-only / listed cases show{' '}
          <span className="font-semibold tracking-wide text-amber-700 dark:text-amber-300">CACHED RESULTS</span>
          {' '}instead of executing here.
        </p>
        {normalizedQuery !== '' && (
          <p className="mb-3 text-xs text-muted-foreground">
            {visibleCount} of {total} tests shown
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1">
          {filteredCategories.map((group) => (
            <span key={group.name} className="contents">
              <span className="mr-1 inline-flex items-center text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {group.name}
              </span>
              {group.tests.map((test) => {
                const cached = isRecordedOnly(test)
                return (
                  <Link
                    key={test.slug}
                    href={`/case/${test.slug}`}
                    title={`${test.title}\n${test.category} · wasm: ${test.wasmMatches ? 'match' : 'mismatch'} · native: ${test.nativeMatches ? 'match' : 'mismatch'}${cached ? '\nCACHED RESULTS — not live in the browser' : ''}`}
                    className={`inline-flex size-4 rounded-sm transition-opacity hover:opacity-70 ${statusColor(test.overallStatus)}${cached ? ' ring-1 ring-amber-500/70 ring-offset-1 ring-offset-background' : ''}`}
                  />
                )
              })}
            </span>
          ))}
          {filteredCategories.length === 0 && (
            <p className="text-muted-foreground">No tests match your filter.</p>
          )}
        </div>
      </main>
    </div>
  )
}
