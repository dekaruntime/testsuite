import type { HatsHost } from './tests'

/**
 * Fixtures that must not live-run in the visitor's browser.
 *
 * Add a category name or a case slug. Native-only hosts (`hosts` without
 * `browser`) and fixtures that install index packages are recorded-only
 * even if they are not listed here.
 *
 * Recorded cases show dump-time stdout and emitted JS, with a read-only
 * editor and a CACHED RESULTS banner so the page is not mistaken for frozen.
 * Everything else keeps the live playground.
 */
export const RECORDED_ONLY_CATEGORIES = new Set<string>([
  'ADHOC',
  'packages',
  'crypto',
  'jwt',
  'json',
  'fs',
  'tcp',
  'tls',
  'http',
  'time',
])

export const RECORDED_ONLY_SLUGS = new Set<string>([
  // e.g. 'error-globals-process-cwd'
])

export function isRecordedOnly(test: {
  category: string
  slug: string
  hosts?: HatsHost[]
  packages?: string[]
}): boolean {
  if (RECORDED_ONLY_SLUGS.has(test.slug)) return true
  if (RECORDED_ONLY_CATEGORIES.has(test.category)) return true
  if (test.packages && test.packages.length > 0) return true
  if (test.hosts && test.hosts.length > 0 && !test.hosts.includes('browser')) return true
  return false
}
