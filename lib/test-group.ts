import type { HatsHost } from '@/lib/tests'

/**
 * The three groups a fixture can belong to, decided by its `hosts`.
 *
 * Group membership is a property of the fixture, not a runtime outcome —
 * a native-only fixture is not "skipped on wasm", it was never a wasm test.
 * Divergence exists only in `shared`, because it is meaningless for a
 * fixture that runs on one host (deka#503, deka#509).
 *
 * `shared` is listed first: it is the largest group and the only one where
 * a host disagreement can be a real compiler defect.
 */
export const GROUP_ORDER = ['shared', 'native-only', 'browser-only'] as const

export type TestGroup = (typeof GROUP_ORDER)[number]

/** One classifier, so the header, the grid and the contents cannot disagree. */
export function groupOf(test: { hosts?: HatsHost[] }): TestGroup {
  const hosts = test.hosts ?? []
  const native = hosts.includes('native')
  const browser = hosts.includes('browser')
  if (native && browser) return 'shared'
  return native ? 'native-only' : 'browser-only'
}
