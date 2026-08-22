import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { tmpdir } from 'os'

export interface NodeRunResult {
  ok: boolean
  stdout: string
  stderr: string
  error?: string
}

/**
 * @deprecated Not the conformance oracle.
 *
 * Conformance execution is `deka run` (native isolate) and a Chromium Worker
 * (browser host). This helper remains only for ad-hoc debugging of emitted JS.
 */
export function runJsInNode(jsCode: string): NodeRunResult {
  const tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'hats-node-run-'))
  const outputPath = path.join(tmpDir, 'test.js')
  fs.writeFileSync(outputPath, jsCode)
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }))

  try {
    const stdout = execSync('node test.js', {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, stdout, stderr: '' }
  } catch (error) {
    const stdout = String((error as { stdout?: string }).stdout ?? '')
    const stderr = String((error as { stderr?: string }).stderr ?? '')
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      stdout,
      stderr,
      error: stderr.trim() || message,
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup.
    }
  }
}
