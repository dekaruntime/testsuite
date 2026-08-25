import { describe, expect, test } from 'bun:test'
import { computeOverallStatus } from './overall-status'

const both = {
  wantNative: true,
  wantBrowser: true,
  nativeAvailable: true,
  browserAvailable: true,
  nativeMatches: true,
  browserMatches: true,
  nativeSkipped: false,
  browserSkipped: false,
}

describe('computeOverallStatus', () => {
  test('both hosts match', () => {
    expect(computeOverallStatus(both)).toBe('pass')
  })

  test('hosts disagree', () => {
    expect(computeOverallStatus({ ...both, browserMatches: false })).toBe('divergent')
  })

  test('browser-only fixture with browser host absent is skip, not fail', () => {
    expect(
      computeOverallStatus({
        wantNative: false,
        wantBrowser: true,
        nativeAvailable: true,
        browserAvailable: false,
        nativeMatches: false,
        browserMatches: false,
        nativeSkipped: true,
        browserSkipped: true,
      })
    ).toBe('skip')
  })

  test('native-only fixture with native host absent is skip', () => {
    expect(
      computeOverallStatus({
        wantNative: true,
        wantBrowser: false,
        nativeAvailable: false,
        browserAvailable: true,
        nativeMatches: false,
        browserMatches: false,
        nativeSkipped: true,
        browserSkipped: true,
      })
    ).toBe('skip')
  })

  test('browser-only fixture that ran and matched is pass', () => {
    expect(
      computeOverallStatus({
        wantNative: false,
        wantBrowser: true,
        nativeAvailable: true,
        browserAvailable: true,
        nativeMatches: false,
        browserMatches: true,
        nativeSkipped: true,
        browserSkipped: false,
      })
    ).toBe('pass')
  })
})
