import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadWasmCompiler, compileWithWasm, formatDsWithWasm } from '../lib/build-wasm.ts'
import { runDekaJsDirect } from '../lib/compiler/runtime.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testsDir = path.join(__dirname, '..', 'tests')

const compiler = await loadWasmCompiler()

async function runSource(source, filename = 'test.ds') {
  const compileResult = compileWithWasm(compiler, source, filename)
  const formatResult = formatDsWithWasm(compiler, source)
  let runResult = { ok: false, stdout: '', stderr: '', error: undefined }
  if (compileResult.ok && compileResult.js) {
    runResult = await runDekaJsDirect(compileResult.js)
  }
  return { compileResult, formatResult, runResult }
}

function determineStage(result) {
  if (result.runResult.ok || (result.compileResult.ok && result.runResult.ok)) return 'run'
  const error = result.compileResult.error || ''
  const js = result.compileResult.js || ''
  if (error && (!js || js.length === 0)) return 'parse'
  return 'typecheck'
}

async function writeTest(category, name, { status, source, title, stage, expectedStdout, expectedCode, expectedDiagnosticContains, notes }) {
  const categoryDir = path.join(testsDir, category)
  const testDir = path.join(categoryDir, name)
  if (fs.existsSync(testDir)) {
    console.log(`[hats] skipped ${category}/${name} (already exists)`)
    return
  }
  fs.mkdirSync(testDir, { recursive: true })

  const ext = status === 'pass' ? 'pass.ds' : 'fail.ds'
  const sourcePath = path.join(testDir, `${name}.${ext}`)
  fs.writeFileSync(sourcePath, source)

  const result = await runSource(source, `${name}.ds`)
  const actualStage = determineStage(result)

  const metadata = {
    title: title || name.replace(/_/g, ' '),
    stage: stage || actualStage,
    notes: notes || '',
  }

  if (status === 'fail') {
    if (!expectedDiagnosticContains) {
      const firstError = result.compileResult.diagnostics.find(d => d.severity === 'error')
      if (firstError) {
        expectedDiagnosticContains = firstError.message
      } else if (result.compileResult.error) {
        expectedDiagnosticContains = result.compileResult.error
      } else if (result.runResult.error) {
        expectedDiagnosticContains = result.runResult.error
      }
    }
    if (expectedDiagnosticContains) {
      metadata.expectedDiagnosticContains = expectedDiagnosticContains
    }
  } else {
    if (expectedStdout === undefined && result.runResult.ok) {
      expectedStdout = result.runResult.stdout
    }
    if (expectedStdout !== undefined) {
      fs.writeFileSync(path.join(testDir, `${name}.stdout`), expectedStdout)
    }
    if (expectedCode === undefined && result.formatResult.ok) {
      expectedCode = result.formatResult.code
    }
    if (expectedCode !== undefined) {
      fs.writeFileSync(path.join(testDir, `${name}.code`), expectedCode)
    }
  }

  fs.writeFileSync(path.join(testDir, `${name}.json`), JSON.stringify(metadata, null, 2) + '\n')
  const actualStatus = (result.compileResult.ok && result.runResult.ok) ? 'pass' : 'fail'
  console.log(`[hats] generated ${category}/${name} -> intended=${status} actual=${actualStatus} ${metadata.stage}`)
}

const tests = []
function add(category, name, def) { tests.push({ category, name, def }) }

// Pass tests
add('basics', 'increment_operator', {
  status: 'pass',
  source: `let i = 0
i++
console.log(i)
`,
  title: 'Post-increment operator',
})

add('basics', 'decrement_operator', {
  status: 'pass',
  source: `let i = 3
i--
console.log(i)
`,
  title: 'Post-decrement operator',
})

add('basics', 'ternary_operator', {
  status: 'pass',
  source: `console.log(true ? 1 : 2)
`,
  title: 'Ternary operator',
})

add('basics', 'exponentiation_operator', {
  status: 'pass',
  source: `console.log(2 ** 3)
`,
  title: 'Exponentiation operator',
})

add('basics', 'modulo_operator', {
  status: 'pass',
  source: `console.log(5 % 2)
`,
  title: 'Modulo operator',
})

add('basics', 'null_literal', {
  status: 'fail',
  stage: 'parse',
  expectedDiagnosticContains: 'Null literals are not allowed in DekaScript',
  source: `const x = null
console.log(x)
`,
  title: 'Null literal is rejected',
})

add('basics', 'undefined_literal_fail', {
  status: 'fail',
  stage: 'parse',
  expectedDiagnosticContains: 'undefined',
  source: `const x = undefined
console.log(x)
`,
  title: 'Undefined pseudo-literal is rejected',
})

add('basics', 'string_escape', {
  status: 'pass',
  source: `const s = "a\\nb"
console.log(s)
`,
  title: 'String escape sequence',
})

add('basics', 'comments_preserved_or_stripped', {
  status: 'pass',
  source: `// leading comment
const x = 1
console.log(x)
`,
  title: 'Comment handling',
})

add('flow_control', 'continue_skip', {
  status: 'pass',
  source: `let i = 0
while (i < 3) {
  i = i + 1
  if (i === 2) { continue }
  console.log(i)
}
`,
  title: 'Continue skips an iteration',
})

add('functions', 'void_return_type', {
  status: 'pass',
  source: `fn log(x: number): void {
  console.log(x)
}
log(5)
`,
  title: 'Void return type',
})

add('functions', 'function_reference', {
  status: 'pass',
  source: `fn add(x: number, y: number): number {
  return x + y
}
const f = add
console.log(f(1, 2))
`,
  title: 'Function reference as a value',
})

add('data_types', 'array_push_mutable', {
  status: 'pass',
  source: `let a = [1, 2]
a.push(3)
console.log(a.length)
`,
  title: 'Mutable array push',
})

add('data_types', 'array_slice', {
  status: 'pass',
  source: `const a = [1, 2, 3]
const b = a.slice(1, 3)
console.log(b.length)
console.log(b[0])
`,
  title: 'Array slice',
})

add('data_types', 'array_map_callback', {
  status: 'pass',
  source: `const arr = [1, 2, 3]
const d = arr.map(fn (x: number): number { return x * 2 })
console.log(d[1])
`,
  title: 'Array map with callback',
})

add('data_types', 'array_filter_callback', {
  status: 'pass',
  source: `const arr = [1, 2, 3, 4]
const evens = arr.filter(fn (x: number): boolean { return x % 2 === 0 })
console.log(evens.length)
`,
  title: 'Array filter with callback',
})

add('data_types', 'array_reduce_callback', {
  status: 'pass',
  source: `const arr = [1, 2, 3]
const sum = arr.reduce(fn (acc: number, x: number): number { return acc + x }, 0)
console.log(sum)
`,
  title: 'Array reduce with callback',
})

add('data_types', 'object_spread', {
  status: 'pass',
  source: `const obj = { a: 1, b: 2 }
const copy = { ...obj, c: 3 }
console.log(copy.c)
`,
  title: 'Object spread',
})

add('data_types', 'bracket_property_access', {
  status: 'pass',
  source: `const obj = { a: 1 }
console.log(obj["a"])
`,
  title: 'Bracket property access',
})

add('data_types', 'string_methods', {
  status: 'pass',
  source: `const s = "hello"
console.log(s.toUpperCase())
console.log(s.length)
`,
  title: 'String methods',
})

add('error_globals', 'console_assert_pass', {
  status: 'pass',
  source: `console.assert(true, "ok")
console.log("done")
`,
  title: 'console.assert passing',
})

add('components', 'jsx_inline_element', {
  status: 'pass',
  source: `const ui = globalThis.deka.ui
const html = ui.renderToString(<h1>Hello</h1>)
console.log(html.html)
`,
  title: 'Inline JSX element',
})

add('async', 'async_return_value', {
  status: 'pass',
  source: `async fn value(): Promise<number> {
  return 7
}
async fn main() {
  const v = await value()
  console.log(v)
}
main()
`,
  title: 'Async return value awaited',
})

add('async', 'async_method', {
  status: 'pass',
  source: `struct Store {
  count: number
}
fn (s Store) async load(): Promise<number> {
  return s.count
}
const store = Store { count: 5 }
async fn main() {
  const v = await store.load()
  console.log(v)
}
main()
`,
  title: 'Async method on struct',
})

// Fail tests
add('basics', 'optional_chaining_rejected', {
  status: 'fail',
  source: `const obj = { a: 1 }
console.log(obj?.a)
`,
  title: 'Optional chaining is rejected',
})

add('basics', 'typeof_rejected', {
  status: 'fail',
  source: `console.log(typeof 1)
`,
  title: 'typeof operator is rejected',
})

add('basics', 'computed_key_rejected', {
  status: 'fail',
  source: `const key = "k"
const obj = { [key]: 1 }
`,
  title: 'Computed object keys are rejected',
})

add('basics', 'option_type_annotation_rejected', {
  status: 'fail',
  source: `const x: string? = "hi"
console.log(x)
`,
  title: 'Option annotation on variable is rejected',
})

add('flow_control', 'continue_outside_loop_fail', {
  status: 'fail',
  source: `continue
`,
  title: 'Continue outside a loop fails',
})

add('error_globals', 'console_assert_fail', {
  status: 'fail',
  source: `console.assert(false, "boom")
`,
  title: 'console.assert false fails at runtime',
})

add('error_globals', 'panic_runtime_fail', {
  status: 'fail',
  source: `panic("oops")
`,
  title: 'panic fails at runtime',
})

add('data_types', 'enum_payload_repeated_type_fail', {
  status: 'fail',
  source: `enum E {
  A(number)
  B(number)
}
`,
  title: 'Enum payloads with repeated types fail',
})

add('types', 'type_alias_rejected', {
  status: 'fail',
  source: `type Name = string
const n: Name = "hi"
console.log(n)
`,
  title: 'Type aliases are rejected',
})

add('interfaces', 'interface_method_wrong_return_fail', {
  status: 'fail',
  source: `interface Greeter {
  fn greet(): string
}
struct Person {
  name: string
}
fn (p Person) greet(): number {
  return 1
}
fn welcome(g: Greeter) {
  console.log(g.greet())
}
welcome(Person { name: "Deka" })
`,
  title: 'Interface method with wrong return type fails',
})

add('components', 'jsx_undefined_attribute_fail', {
  status: 'fail',
  source: `const ui = globalThis.deka.ui
const html = ui.renderToString(ui.jsx("div", { class: undefined }))
console.log(html.html)
`,
  title: 'JSX attribute set to undefined fails',
})

for (const { category, name, def } of tests) {
  await writeTest(category, name, def)
}

console.log(`[hats] generated ${tests.length} audit tests`)
