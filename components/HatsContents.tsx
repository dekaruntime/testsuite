'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { statusColor } from '@/components/HatsGrid'
import type { HatsCategoryWithResults } from '@/lib/build-tests'
import { isRecordedOnly } from '@/lib/recorded-only'
import { GROUP_ORDER, groupOf } from '@/lib/test-group'

interface HatsContentsProps {
  categories: HatsCategoryWithResults[]
  currentSlug: string
  onSelect?: () => void
  onClose?: () => void
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function HatsContents({ categories, currentSlug, onSelect, onClose }: HatsContentsProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = normalize(query)
  const activeRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [currentSlug])

  const filteredCategories = useMemo(() => {
    if (normalizedQuery === '') return categories
    return categories
      .map((group) => ({
        ...group,
        tests: group.tests.filter(
          (test) =>
            test.title.toLowerCase().includes(normalizedQuery) ||
            test.slug.toLowerCase().includes(normalizedQuery) ||
            test.category.toLowerCase().includes(normalizedQuery)
        ),
      }))
      .filter((group) => group.tests.length > 0)
  }, [categories, normalizedQuery])

  const visibleCount = filteredCategories.reduce((sum, group) => sum + group.tests.length, 0)
  const totalCount = categories.reduce((sum, group) => sum + group.tests.length, 0)

  return (
    <div className="flex h-full flex-col bg-card text-card-foreground">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold">Contents</h2>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close contents">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="border-b border-border p-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter tests…"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
        />
        {normalizedQuery !== '' && (
          <p className="mt-2 text-xs text-muted-foreground">
            {visibleCount} of {totalCount} tests shown
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-5">
          {GROUP_ORDER.flatMap((groupName) =>
            filteredCategories
              .map((category) => ({
                ...category,
                name: `${groupName.toUpperCase()} / ${category.name}`,
                tests: category.tests.filter((test) => groupOf(test) === groupName),
              }))
              .filter((category) => category.tests.length > 0)
          ).map((group) => (
            <div key={group.name}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.name}
              </h3>
              <ul className="space-y-0.5">
                {group.tests.map((test) => {
                  const active = test.slug === currentSlug
                  const cached = isRecordedOnly(test)
                  return (
                    <li key={test.slug}>
                      <Link
                        ref={active ? activeRef : undefined}
                        href={`/case/${test.slug}`}
                        onClick={onSelect}
                        className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                          active
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-muted'
                        }`}
                      >
                        <span
                          className={`size-2.5 shrink-0 rounded-sm ${statusColor(test.overallStatus)}`}
                          aria-hidden="true"
                        />
                        <span className="truncate">{test.title}</span>
                        {cached ? (
                          <span
                            className={`ml-auto shrink-0 text-[10px] font-semibold tracking-wide ${
                              active ? 'text-primary-foreground/80' : 'text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            CACHED
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          {filteredCategories.length === 0 && (
            <p className="text-sm text-muted-foreground">No tests match your filter.</p>
          )}
        </div>
      </div>
    </div>
  )
}
