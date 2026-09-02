'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { HatsCategoryWithResults, HatsGroups, HatsTestWithBuildResult } from '@/lib/build-tests'
import type { HatsOverallStatus } from '@/lib/overall-status'
import type { HatsHost } from '@/lib/tests'
import { isRecordedOnly } from '@/lib/recorded-only'

interface HatsGridProps {
  categories: HatsCategoryWithResults[]
  groups?: HatsGroups
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

export function HatsGrid({ categories, groups, nativeAvailable, browserAvailable = true, version }: HatsGridProps) {
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

  // Three groups, decided by each fixture's `hosts`. Divergence exists only in
  // `shared`: it is meaningless for a fixture that runs on one host, and
  // computing it corpus-wide made harness gaps look like compiler defects
  // (deka#509). There is no skip bucket -- a native-only fixture is not
  // "skipped on wasm", it was never a wasm test.
  //
  // These numbers are READ from the pack, never recomputed here. One producer
  // owns every figure (deka#503, TESTING.md).

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
            {groups ? (
              <>
                <p className="tabular-nums">
                  <span className="font-medium text-foreground">native-only:</span>{' '}
                  {groups['native-only'].pass} pass · {groups['native-only'].fail} fail ·{' '}
                  {groups['native-only'].total} tests
                </p>
                <p className="tabular-nums">
                  <span className="font-medium text-foreground">shared:</span>{' '}
                  {groups.shared.pass} pass · {groups.shared.fail} fail ·{' '}
                  {groups.shared.diverge} diverge · {groups.shared.total} tests
                </p>
                <p className="tabular-nums">
                  <span className="font-medium text-foreground">browser-only:</span>{' '}
                  {groups['browser-only'].pass} pass · {groups['browser-only'].fail} fail ·{' '}
                  {groups['browser-only'].total} tests
                </p>
              </>
            ) : (
              <p className="text-amber-500">
                this pack carries no summary — rebuild it with a current dump
              </p>
            )}
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
