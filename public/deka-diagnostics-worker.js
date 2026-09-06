// The diagnostics worker loads the latest reviewed artifact from the public R2
// bucket at dsc-wasm.deka.gg. It validates ABI compatibility but does not pin a
// specific source revision, so the tour stays current with runtime releases.
const MANIFEST_URL = 'https://dsc-wasm.deka.gg/latest/deka-diagnostics-artifact.json'
const REQUIRED_ABI = 1
let adapterPromise

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function unavailable() { self.postMessage({ type: 'unavailable' }) }
function failed(message) { self.postMessage({ type: 'error', message }) }
function isChecksum(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) }

function validateManifest(value) {
  if (!value || typeof value !== 'object') throw new Error('diagnostics manifest is not an object')
  const { schemaVersion, diagnostics, producer, artifact } = value
  if (schemaVersion !== 1 || diagnostics?.name !== 'deka_diagnostics' || diagnostics?.abiVersion < REQUIRED_ABI ||
      typeof diagnostics?.sourceCommit !== 'string' || diagnostics.sourceCommit.length < 40 ||
      producer?.schemaVersion !== 1 || producer?.target !== 'wasm32-unknown-unknown' || !isChecksum(producer?.cargoLockSha256) ||
      artifact?.file !== 'deka_diagnostics.wasm' || !isChecksum(artifact?.sha256) || !Number.isSafeInteger(artifact?.bytes) || artifact.bytes <= 0) {
    throw new Error('diagnostics manifest is incompatible')
  }
  return value
}

async function sha256(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function readResult(exports, resultPtr) {
  if (!Number.isInteger(resultPtr) || resultPtr <= 0) throw new Error('diagnostics adapter allocation failed')
  const header = new DataView(exports.memory.buffer, resultPtr, 8)
  const jsonPtr = header.getUint32(0, true)
  const jsonLen = header.getUint32(4, true)
  if (!jsonPtr || !jsonLen || jsonPtr + jsonLen > exports.memory.buffer.byteLength) throw new Error('diagnostics adapter returned an invalid result')
  const resultBytes = new Uint8Array(exports.memory.buffer, jsonPtr, jsonLen)
  try { return { value: JSON.parse(textDecoder.decode(resultBytes)), bytes: 8 + jsonLen } }
  finally { exports.deka_diagnostics_free(resultPtr, 8 + jsonLen) }
}

function checkExports(exports) {
  for (const name of ['memory', 'deka_diagnostics_alloc', 'deka_diagnostics_analyze', 'deka_diagnostics_free', 'deka_diagnostics_metadata']) {
    if (!(name in exports)) throw new Error(`required Deka diagnostics ABI export is missing: ${name}`)
  }
}

async function loadAdapter() {
  const manifestResponse = await fetch(MANIFEST_URL, { cache: 'no-store' })
  if (manifestResponse.status === 404) return null
  if (!manifestResponse.ok) throw new Error(`diagnostics manifest request failed: ${manifestResponse.status}`)
  const manifest = validateManifest(await manifestResponse.json())
  const artifactResponse = await fetch(new URL(manifest.artifact.file, MANIFEST_URL), { cache: 'no-store' })
  if (artifactResponse.status === 404) return null
  if (!artifactResponse.ok) throw new Error(`diagnostics artifact request failed: ${artifactResponse.status}`)
  const bytes = await artifactResponse.arrayBuffer()
  if (bytes.byteLength !== manifest.artifact.bytes || await sha256(bytes) !== manifest.artifact.sha256) throw new Error('diagnostics artifact checksum mismatch')
  const { instance } = await WebAssembly.instantiate(bytes)
  const exports = instance.exports
  checkExports(exports)
  const metadata = readResult(exports, exports.deka_diagnostics_metadata()).value
  if (metadata?.name !== 'deka_diagnostics' || metadata?.abi_version !== REQUIRED_ABI) throw new Error('diagnostics WASM ABI metadata mismatch')
  return exports
}

function write(exports, value) {
  const bytes = textEncoder.encode(value)
  if (bytes.length === 0) return [0, 0]
  const ptr = exports.deka_diagnostics_alloc(bytes.length)
  if (!ptr) throw new Error('diagnostics adapter request allocation failed')
  new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes)
  return [ptr, bytes.length]
}

function isPosition(value, lines) {
  return Number.isInteger(value?.line) && Number.isInteger(value?.character) && value.line >= 0 && value.character >= 0 && value.line < lines.length && value.character <= lines[value.line].length
}
function normalizeDiagnostics(response, document) {
  if (!response || response.abi_version !== REQUIRED_ABI || response.uri_or_path !== document.uri || response.accepted !== true || !Array.isArray(response.diagnostics)) throw new Error('diagnostics response is incompatible')
  const lines = document.text.split('\n')
  return response.diagnostics.flatMap((item) => {
    if (!item || typeof item.message !== 'string' || !isPosition(item.range?.start, lines) || !isPosition(item.range?.end, lines)) return []
    const { start, end } = item.range
    if (end.line < start.line || (end.line === start.line && end.character < start.character)) return []
    const severity = ({ error: 1, warning: 2, information: 3, hint: 4 })[item.severity] ?? 3
    return [{ range: { start, end }, message: item.message, severity, source: typeof item.source === 'string' ? item.source : undefined, code: typeof item.code === 'string' || typeof item.code === 'number' ? item.code : undefined }]
  })
}

self.onmessage = async ({ data }) => {
  if (!data || data.type !== 'update' || data.document?.languageId !== 'dekascript' || typeof data.document.uri !== 'string' || !data.document.uri.endsWith('.ds') || typeof data.document.text !== 'string' || !Number.isSafeInteger(data.document.version)) return
  try {
    adapterPromise ??= loadAdapter()
    const exports = await adapterPromise
    if (!exports) return unavailable()
    const [sourcePtr, sourceLen] = write(exports, data.document.text)
    const [uriPtr, uriLen] = write(exports, data.document.uri)
    try {
      const response = readResult(exports, exports.deka_diagnostics_analyze(sourcePtr, sourceLen, uriPtr, uriLen)).value
      self.postMessage({ type: 'diagnostics', uri: data.document.uri, version: data.document.version, diagnostics: normalizeDiagnostics(response, data.document) })
    } finally {
      if (sourceLen) exports.deka_diagnostics_free(sourcePtr, sourceLen)
      if (uriLen) exports.deka_diagnostics_free(uriPtr, uriLen)
    }
  } catch (error) { failed(error instanceof Error ? error.message : 'diagnostics worker failed') }
}
