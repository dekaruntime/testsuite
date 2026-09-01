'use client'

/**
 * Line-level diff between the expected (fixture) source and what the formatter
 * actually produced.
 *
 * A case can be marked divergent purely because these two strings differ, while
 * both hosts compile and run it correctly. Printing the two blocks side by side
 * left the reader to spot a single changed character; this shows which lines
 * changed, git-style.
 */

type Op = 'same' | 'add' | 'del'

interface Row {
  op: Op
  /** 1-based line number in the expected text, if the line exists there. */
  left?: number
  /** 1-based line number in the actual text, if the line exists there. */
  right?: number
  text: string
}

/**
 * Longest common subsequence over lines. The inputs here are single source
 * files — tens of lines — so the O(n*m) table is not worth optimising away,
 * and it produces a minimal, stable diff rather than the noisy output a
 * greedy walk gives when a line is inserted near the top.
 */
function diffLines(expected: string[], actual: string[]): Row[] {
  const n = expected.length
  const m = actual.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        expected[i] === actual[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const rows: Row[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (expected[i] === actual[j]) {
      rows.push({ op: 'same', left: i + 1, right: j + 1, text: expected[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ op: 'del', left: i + 1, text: expected[i] })
      i++
    } else {
      rows.push({ op: 'add', right: j + 1, text: actual[j] })
      j++
    }
  }
  while (i < n) rows.push({ op: 'del', left: i + 1, text: expected[i++] })
  while (j < m) rows.push({ op: 'add', right: j + 1, text: actual[j++] })
  return rows
}

/** Collapse long runs of unchanged lines, keeping `context` on each side. */
function withElisions(rows: Row[], context = 3): (Row | { op: 'gap'; count: number })[] {
  const changed = new Set<number>()
  rows.forEach((row, index) => {
    if (row.op === 'same') return
    for (let k = index - context; k <= index + context; k++) changed.add(k)
  })

  const out: (Row | { op: 'gap'; count: number })[] = []
  let run = 0
  rows.forEach((row, index) => {
    if (changed.has(index)) {
      if (run > 0) {
        out.push({ op: 'gap', count: run })
        run = 0
      }
      out.push(row)
    } else {
      run++
    }
  })
  if (run > 0) out.push({ op: 'gap', count: run })
  return out
}

export function CodeDiff({
  expected,
  actual,
  expectedLabel = 'expected (fixture)',
  actualLabel = 'actual (formatter)',
}: {
  expected: string
  actual: string
  expectedLabel?: string
  actualLabel?: string
}) {
  if (expected === actual) return null

  const rows = diffLines(expected.split('\n'), actual.split('\n'))
  const added = rows.filter((r) => r.op === 'add').length
  const removed = rows.filter((r) => r.op === 'del').length
  const display = withElisions(rows)

  return (
    <div className="overflow-hidden rounded border border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1.5 text-xs">
        <span className="text-muted-foreground">
          <span className="text-red-500">− {expectedLabel}</span>
          {' · '}
          <span className="text-green-600 dark:text-green-500">+ {actualLabel}</span>
        </span>
        <span className="tabular-nums text-muted-foreground">
          <span className="text-green-600 dark:text-green-500">+{added}</span>{' '}
          <span className="text-red-500">−{removed}</span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <tbody>
            {display.map((row, index) => {
              if (row.op === 'gap') {
                return (
                  <tr key={`gap-${index}`} className="bg-muted/30 text-muted-foreground">
                    <td colSpan={3} className="px-3 py-0.5 text-center select-none">
                      ⋯ {row.count} unchanged {row.count === 1 ? 'line' : 'lines'}
                    </td>
                  </tr>
                )
              }

              const tone =
                row.op === 'add'
                  ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                  : row.op === 'del'
                    ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                    : ''
              const marker = row.op === 'add' ? '+' : row.op === 'del' ? '−' : ' '

              return (
                <tr key={index} className={tone}>
                  <td className="w-10 select-none border-r border-border px-2 py-0.5 text-right align-top tabular-nums text-muted-foreground">
                    {row.left ?? ''}
                  </td>
                  <td className="w-10 select-none border-r border-border px-2 py-0.5 text-right align-top tabular-nums text-muted-foreground">
                    {row.right ?? ''}
                  </td>
                  <td className="whitespace-pre px-3 py-0.5">
                    <span className="select-none pr-2 opacity-60">{marker}</span>
                    {row.text === '' ? ' ' : row.text}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
