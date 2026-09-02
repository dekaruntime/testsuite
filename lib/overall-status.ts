export type HatsOverallStatus = 'pass' | 'fail' | 'divergent' | 'skip'

export function computeOverallStatus(args: {
  wantNative: boolean
  wantBrowser: boolean
  nativeAvailable: boolean
  browserAvailable: boolean
  nativeMatches: boolean
  browserMatches: boolean
  nativeSkipped: boolean
  browserSkipped: boolean
}): HatsOverallStatus {
  const nativeRan = args.wantNative && args.nativeAvailable && !args.nativeSkipped
  const browserRan = args.wantBrowser && args.browserAvailable && !args.browserSkipped

  // RFD 26: a host that did not run cannot fail a fixture. Browser-only
  // cases used to flip fail→pass when Chromium came back because absence
  // was scored as fail.
  if (!nativeRan && !browserRan) return 'skip'

  const nativeOk = !nativeRan || args.nativeMatches
  const browserOk = !browserRan || args.browserMatches
  if (nativeOk && browserOk) return 'pass'
  if (nativeRan && browserRan && args.nativeMatches !== args.browserMatches) return 'divergent'
  return 'fail'
}


/**
 * The verdict for a test, tolerating packs built either side of deka#533.
 *
 * `status` on a test is its EXPECTATION -- a `.fail.ds` fixture expects
 * compilation to fail and carries `status: fail` while working correctly.
 * 381 of 796 tests do. Never render `status` as an outcome.
 */
export function verdictOf(test: { verdict?: HatsOverallStatus; overallStatus: HatsOverallStatus }): HatsOverallStatus {
  return test.verdict ?? test.overallStatus
}
