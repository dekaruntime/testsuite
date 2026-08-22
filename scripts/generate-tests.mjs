import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadWasmCompiler, compileWithWasm, formatDsWithWasm } from '../lib/build-wasm.ts'
import { runDekaJsDirect } from '@dekaruntime/web-ide-kit/runtime'

// Maintainer seed script only. Public coverage is a PR to tests/. Do not treat
// this file as the source of truth. Runtime snapshots should come from
// `deka run` / the browser host (`scripts/regen-fixtures.mjs`), not Node.

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

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function writeTest(category, name, { status, source, title, stage, expectedStdout, expectedCode, expectedDiagnosticContains, notes }) {
  const categoryDir = path.join(testsDir, category)
  const testDir = path.join(categoryDir, name)
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
  console.log(`[hats] generated ${category}/${name} -> ${status} ${metadata.stage}`)
}

// ---------------------------------------------------------------------------
// Test definitions
// ---------------------------------------------------------------------------

const tests = []

function add(category, name, def) {
  tests.push({ category, name, def })
}

// --- basics ---
add('basics', 'numeric_addition', {
  status: 'pass',
  source: `const a = 2
const b = 3
console.log(a + b)
`,
  title: 'Integer addition',
})

add('basics', 'string_concatenation', {
  status: 'pass',
  source: `const greeting = "Hello, "
const name = "Deka"
console.log(greeting + name)
`,
  title: 'String concatenation with +',
})

add('basics', 'template_string', {
  status: 'pass',
  source: `const name = "Deka"
console.log(\`Welcome, \${name}!\`)
`,
  title: 'Template string interpolation',
})

add('basics', 'const_mutation_fail', {
  status: 'fail',
  source: `const x = 1
x = 2
console.log(x)
`,
  title: 'Mutating a const binding fails',
})

add('basics', 'missing_semicolon_single_line', {
  status: 'fail',
  source: `const x = 1`,
  title: 'Missing semicolon on a single-line statement fails',
})

add('basics', 'type_annotation', {
  status: 'pass',
  source: `const n: number = 42
console.log(n)
`,
  title: 'Variable with a type annotation',
})

add('basics', 'let_mutation', {
  status: 'pass',
  source: `let x = 1
x = 2
console.log(x)
`,
  title: 'Mutating a let binding',
})

add('basics', 'operator_precedence', {
  status: 'pass',
  source: `console.log(2 + 3 * 4)
`,
  title: 'Operator precedence',
})

add('basics', 'boolean_logic', {
  status: 'pass',
  source: `console.log(true && false)
console.log(true || false)
`,
  title: 'Boolean logic operators',
})

add('basics', 'comparison_operators', {
  status: 'pass',
  source: `console.log(1 < 2)
console.log(5 >= 5)
console.log("a" === "a")
`,
  title: 'Comparison operators',
})

add('basics', 'undefined_variable_fail', {
  status: 'fail',
  source: `console.log(missingVariable)
`,
  title: 'Reference to an undefined variable fails',
})

// --- functions ---
add('functions', 'simple_function', {
  status: 'pass',
  source: `fn double(x: number): number {
  return x * 2
}
console.log(double(5))
`,
  title: 'Simple function declaration and call',
})

add('functions', 'multiple_params', {
  status: 'pass',
  source: `fn add(a: number, b: number, c: number): number {
  return a + b + c
}
console.log(add(1, 2, 3))
`,
  title: 'Function with multiple parameters',
})

add('functions', 'factorial_recursion', {
  status: 'pass',
  source: `fn factorial(n: number): number {
  if (n <= 1) {
    return 1
  }
  return n * factorial(n - 1)
}
console.log(factorial(5))
`,
  title: 'Recursive factorial function',
})

add('functions', 'wrong_arity_fail', {
  status: 'fail',
  source: `fn add(x: number, y: number): number {
  return x + y
}
console.log(add(1))
`,
  title: 'Calling a function with too few arguments fails',
})

add('functions', 'mutable_receiver', {
  status: 'pass',
  source: `struct Counter {
  value: number
}
fn (c mut Counter) increment(): void {
  c.value = c.value + 1
}
let c = Counter { value: 0 }
c.increment()
console.log(c.value)
`,
  title: 'Mutable receiver method',
})

add('functions', 'method_on_immutable_fail', {
  status: 'fail',
  source: `struct Counter {
  value: number
}
fn (c mut Counter) increment(): void {
  c.value = c.value + 1
}
const c = Counter { value: 0 }
c.increment()
`,
  title: 'Calling a mutable method on an immutable value fails',
})

add('functions', 'shadowing', {
  status: 'pass',
  source: `const x = 1
fn shadow(): number {
  const x = 2
  return x
}
console.log(shadow())
console.log(x)
`,
  title: 'Local variable shadowing',
})

add('functions', 'return_type_mismatch_fail', {
  status: 'fail',
  source: `fn answer(): number {
  return "forty-two"
}
console.log(answer())
`,
  title: 'Returning a wrong-typed value fails',
})

add('functions', 'nested_function_call', {
  status: 'pass',
  source: `fn inc(x: number): number {
  return x + 1
}
fn double(x: number): number {
  return x * 2
}
console.log(double(inc(3)))
`,
  title: 'Nested function calls',
})

add('functions', 'function_no_return_type', {
  status: 'pass',
  source: `fn greet(name: string) {
  console.log("Hi " + name)
}
greet("Deka")
`,
  title: 'Function with no explicit return type',
})

// --- flow_control ---
add('flow_control', 'if_else', {
  status: 'pass',
  source: `const x = 5
if (x > 3) {
  console.log("big")
} else {
  console.log("small")
}
`,
  title: 'If/else branch',
})

add('flow_control', 'for_of_loop', {
  status: 'pass',
  source: `const items = ["a", "b", "c"]
for (const item of items) {
  console.log(item)
}
`,
  title: 'For-of loop over an array',
})

add('flow_control', 'match_enum', {
  status: 'pass',
  source: `enum Status {
  Loading
  Ready
  Failed
}
const current = Status.Ready
const label = match (current) {
  Status.Loading => "loading",
  Status.Ready => "ready",
  Status.Failed => "failed",
  _ => "unknown"
}
console.log(label)
`,
  title: 'Match expression with enum',
})

add('flow_control', 'match_option_some', {
  status: 'pass',
  source: `const maybe: string? = "present"
const result = match (maybe) {
  Some(value) => value,
  None => "absent",
  _ => "unknown"
}
console.log(result)
`,
  title: 'Match expression with Some',
})

add('flow_control', 'match_option_none', {
  status: 'pass',
  source: `const maybe: string? = None
const result = match (maybe) {
  Some(value) => value,
  None => "absent",
  _ => "unknown"
}
console.log(result)
`,
  title: 'Match expression with None',
})

add('flow_control', 'match_missing_arm_fail', {
  status: 'fail',
  source: `enum Color {
  Red
  Green
  Blue
}
const c = Color.Red
match (c) {
  Color.Red => "red",
  Color.Green => "green"
}
`,
  title: 'Match without a covering arm fails',
})

add('flow_control', 'if_condition_not_bool_fail', {
  status: 'fail',
  source: `if ("truthy") {
  console.log("yes")
}
`,
  title: 'Non-boolean if condition fails',
})

add('flow_control', 'for_of_non_iterable_fail', {
  status: 'fail',
  source: `for (const x of 42) {
  console.log(x)
}
`,
  title: 'For-of over a non-iterable fails',
})

add('flow_control', 'if_without_else', {
  status: 'pass',
  source: `const x = 5
if (x > 3) {
  console.log("big")
}
console.log("done")
`,
  title: 'If without else',
})

add('flow_control', 'match_default_only', {
  status: 'pass',
  source: `const n = 7
const label = match (n) {
  _ => "fallback"
}
console.log(label)
`,
  title: 'Match with only a default arm',
})

// --- data_types ---
add('data_types', 'struct_fields', {
  status: 'pass',
  source: `struct Point {
  x: number
  y: number
}
const p = Point { x: 1, y: 2 }
console.log(p.x + p.y)
`,
  title: 'Struct field access',
})

add('data_types', 'struct_missing_field_fail', {
  status: 'fail',
  source: `struct Point {
  x: number
  y: number
}
const p = Point { x: 1 }
console.log(p.y)
`,
  title: 'Missing struct field in initializer fails',
})

add('data_types', 'struct_method', {
  status: 'pass',
  source: `struct Point {
  x: number
  y: number
}
fn (p Point) sum(): number {
  return p.x + p.y
}
const p = Point { x: 3, y: 4 }
console.log(p.sum())
`,
  title: 'Struct method call',
})

add('data_types', 'struct_immutable_field_fail', {
  status: 'fail',
  source: `struct Point {
  x: number
}
const p = Point { x: 1 }
p.x = 2
`,
  title: 'Mutating an immutable struct field fails',
})

add('data_types', 'struct_embedding_behavior', {
  status: 'pass',
  source: `struct Person {
  name: string
}
fn (p Person) greet(): string {
  return "Hello, " + p.name
}
struct Employee {
  Person
  id: string
}
fn (e Employee) greet(): string {
  return "Hi, " + e.name
}
const e = Employee { Person: Person { name: "Charlie" }, id: "E1" }
console.log(e.greet())
`,
  title: 'Struct embedding with method override',
})

add('data_types', 'array_length_and_index', {
  status: 'pass',
  source: `const items = [10, 20, 30]
console.log(items.length)
console.log(items[1])
`,
  title: 'Array length and index access',
})

add('data_types', 'object_literals', {
  status: 'pass',
  source: `const user = { name: "Deka", score: 100 }
console.log(user.name)
console.log(user.score)
`,
  title: 'Object literal property access',
})

add('data_types', 'nested_objects', {
  status: 'pass',
  source: `const nested = { outer: { inner: 42 } }
console.log(nested.outer.inner)
`,
  title: 'Nested object access',
})

add('data_types', 'optional_field_present', {
  status: 'pass',
  source: `struct User {
  name: string
  email?: string
}
const u = User { name: "Deka", email: "hi@deka.gg" }
console.log(u.name)
`,
  title: 'Optional field present',
})

add('data_types', 'optional_field_absent', {
  status: 'pass',
  source: `struct User {
  name: string
  email?: string
}
const u = User { name: "Deka" }
console.log(u.name)
`,
  title: 'Optional field absent',
})

add('data_types', 'array_mutation', {
  status: 'pass',
  source: `let items = [1, 2, 3]
items[0] = 9
console.log(items[0])
`,
  title: 'Mutable array element assignment',
})

add('data_types', 'array_out_of_bounds_runtime', {
  status: 'pass',
  source: `const items = [1, 2]
console.log(items[10])
`,
  title: 'Out-of-bounds array access runtime behavior',
})

// --- interfaces ---
add('interfaces', 'interface_satisfied', {
  status: 'pass',
  source: `interface Named {
  name: string
}
struct Person {
  name: string
}
fn printName(n: Named) {
  console.log(n.name)
}
const p = Person { name: "Charlie" }
printName(p)
`,
  title: 'Struct satisfies a simple interface',
})

add('interfaces', 'interface_method', {
  status: 'pass',
  source: `interface Greeter {
  fn greet(): string
}
struct Person {
  name: string
}
fn (p Person) greet(): string {
  return "Hello, " + p.name
}
fn welcome(g: Greeter) {
  console.log(g.greet())
}
welcome(Person { name: "Deka" })
`,
  title: 'Interface with method signature',
})

add('interfaces', 'interface_optional_field', {
  status: 'pass',
  source: `interface CardProps {
  title: string
  subtitle?: string
}
fn show(props: CardProps) {
  console.log(props.title)
}
show({ title: "Hello" })
`,
  title: 'Interface with optional field',
})

add('interfaces', 'interface_missing_field_fail', {
  status: 'fail',
  source: `interface Named {
  name: string
}
fn printName(n: Named) {
  console.log(n.name)
}
printName({})
`,
  title: 'Object missing required interface field fails',
})

add('interfaces', 'interface_mut_field', {
  status: 'pass',
  source: `interface MutableNamed {
  mut name: string
}
fn rename(n: MutableNamed) {
  n.name = "New"
}
let p = { name: "Old" }
rename(p)
console.log(p.name)
`,
  title: 'Mutable field in interface',
})

add('interfaces', 'interface_method_missing_fail', {
  status: 'fail',
  source: `interface Greeter {
  fn greet(): string
}
struct Person {
  name: string
}
fn welcome(g: Greeter) {
  console.log(g.greet())
}
welcome(Person { name: "Deka" })
`,
  title: 'Struct missing interface method fails',
})

// --- components ---
add('components', 'jsx_element', {
  status: 'pass',
  source: `const ui = globalThis.deka.ui
const html = ui.renderToString(ui.jsx("h1", { children: "Hello" }))
console.log(html.html)
`,
  title: 'Render a JSX element to string',
})

add('components', 'jsx_fragment', {
  status: 'pass',
  source: `const ui = globalThis.deka.ui
const html = ui.renderToString(ui.jsxs(ui.Fragment, { children: ["a", "b"] }))
console.log(html.html)
`,
  title: 'Render a JSX fragment',
})

add('components', 'jsx_function_component', {
  status: 'pass',
  source: `const ui = globalThis.deka.ui
fn Greeting(props: object) object {
  return ui.jsx("h1", { children: "Hello " + props.name })
}
const html = ui.renderToString(ui.jsx(Greeting, { name: "Deka" }))
console.log(html.html)
`,
  title: 'Render a function component',
})

add('components', 'jsx_boolean_attribute', {
  status: 'pass',
  source: `const ui = globalThis.deka.ui
const html = ui.renderToString(ui.jsx("button", { disabled: true, children: "Save" }))
console.log(html.html)
`,
  title: 'JSX boolean attribute',
})

add('components', 'jsx_nested_elements', {
  status: 'pass',
  source: `const ui = globalThis.deka.ui
const html = ui.renderToString(
  ui.jsxs("div", { children: [ui.jsx("p", { children: "one" }), ui.jsx("p", { children: "two" })] })
)
console.log(html.html)
`,
  title: 'Nested JSX elements',
})

add('components', 'jsx_spread_fail', {
  status: 'fail',
  source: `const props = { name: "Deka" }
const el = <div {...props} />
console.log(el)
`,
  title: 'JSX spread is rejected',
})

// --- error_globals ---
add('error_globals', 'console_log', {
  status: 'pass',
  source: `console.log("hello world")
`,
  title: 'console.log global',
})

add('error_globals', 'math_sqrt', {
  status: 'pass',
  source: `console.log(Math.sqrt(16))
`,
  title: 'Math.sqrt global',
})

add('error_globals', 'json_stringify', {
  status: 'pass',
  source: `const obj = { a: 1 }
console.log(JSON.stringify(obj))
`,
  title: 'JSON.stringify',
})

add('error_globals', 'json_parse', {
  status: 'pass',
  source: `const parsed = JSON.parse('{\"x\":1}')
console.log(parsed.x)
`,
  title: 'JSON.parse',
})

add('error_globals', 'option_some_none_match', {
  status: 'pass',
  source: `const a: string? = Some("value")
const b: string? = None
console.log(match (a) { Some(v) => v, None => "empty", _ => "?" })
console.log(match (b) { Some(v) => v, None => "empty", _ => "?" })
`,
  title: 'Option Some and None match',
})

add('error_globals', 'invalid_syntax_fail', {
  status: 'fail',
  source: `fn broken(
  console.log("x")
}
`,
  title: 'Invalid syntax fails to parse',
})

add('error_globals', 'type_mismatch_fail', {
  status: 'fail',
  source: `const x: number = "not a number"
console.log(x)
`,
  title: 'Type mismatch in binding fails',
})

// --- second wave: edge-case fail tests ---

add('basics', 'redeclare_const_fail', {
  status: 'fail',
  source: `const x = 1
const x = 2
console.log(x)
`,
  title: 'Redeclaring a const binding fails',
})

add('basics', 'use_before_declaration_fail', {
  status: 'fail',
  source: `console.log(x)
const x = 1
`,
  title: 'Using a variable before declaration fails',
})

add('basics', 'mutate_frozen_object_fail', {
  status: 'fail',
  source: `const obj = { a: 1 }
obj.a = 2
`,
  title: 'Mutating a frozen object fails',
})

add('functions', 'duplicate_parameter_fail', {
  status: 'fail',
  source: `fn add(x: number, x: number): number {
  return x + x
}
console.log(add(1, 2))
`,
  title: 'Duplicate parameter names fail',
})

add('functions', 'return_outside_function_fail', {
  status: 'fail',
  source: `return 1
`,
  title: 'Return statement outside a function fails',
})

add('functions', 'missing_return_fail', {
  status: 'fail',
  source: `fn answer(): number {
  const x = 42
}
console.log(answer())
`,
  title: 'Missing return for a non-void function fails',
})

add('functions', 'call_undefined_function_fail', {
  status: 'fail',
  source: `console.log(undefinedFn())
`,
  title: 'Calling an undefined function fails',
})

add('flow_control', 'break_outside_loop_fail', {
  status: 'fail',
  source: `break
`,
  title: 'Break outside a loop fails',
})

add('flow_control', 'match_on_non_enum_fail', {
  status: 'fail',
  source: `const x = "hello"
match (x) {
  "a" => 1,
  _ => 2
}
`,
  title: 'Match on a non-enum value fails',
})

add('flow_control', 'for_loop', {
  status: 'pass',
  source: `for (let i = 0; i < 3; i = i + 1) {
  console.log(i)
}
`,
  title: 'C-style for loop',
})

add('data_types', 'duplicate_struct_field_fail', {
  status: 'fail',
  source: `struct Point {
  x: number
  x: number
}
const p = Point { x: 1 }
`,
  title: 'Duplicate struct field fails',
})

add('data_types', 'embed_same_struct_twice_fail', {
  status: 'fail',
  source: `struct A {
  value: number
}
struct B {
  A
  A
}
const b = B { A: A { value: 1 } }
`,
  title: 'Embedding the same struct twice fails',
})

add('data_types', 'embedding_method_ambiguity_fail', {
  status: 'fail',
  source: `struct Runner {}
fn (r Runner) move(): string {
  return "running"
}
struct Swimmer {}
fn (s Swimmer) move(): string {
  return "swimming"
}
struct Triathlete {
  Runner
  Swimmer
}
const t = Triathlete { Runner: Runner {}, Swimmer: Swimmer {} }
console.log(t.move())
`,
  title: 'Ambiguous embedded method fails',
})

add('data_types', 'access_missing_field_fail', {
  status: 'fail',
  source: `struct Point {
  x: number
}
const p = Point { x: 1 }
console.log(p.y)
`,
  title: 'Accessing a missing struct field fails',
})

add('data_types', 'negative_array_index', {
  status: 'pass',
  source: `const items = ["a", "b"]
console.log(items[-1])
`,
  title: 'Negative array index behavior',
})

add('interfaces', 'interface_field_type_mismatch_fail', {
  status: 'fail',
  source: `interface Named {
  name: string
}
fn printName(n: Named) {
  console.log(n.name)
}
printName({ name: 42 })
`,
  title: 'Interface field type mismatch fails',
})

add('interfaces', 'interface_mut_on_immutable_fail', {
  status: 'fail',
  source: `interface MutableNamed {
  mut name: string
}
fn rename(n: MutableNamed) {
  n.name = "New"
}
const p = { name: "Old" }
rename(p)
`,
  title: 'Mutable interface method on immutable object fails',
})

add('components', 'jsx_unclosed_tag_fail', {
  status: 'fail',
  source: `const el = <div>hello
console.log(el)
`,
  title: 'Unclosed JSX tag fails',
})

add('components', 'jsx_undefined_component_fail', {
  status: 'fail',
  source: `const ui = globalThis.deka.ui
const html = ui.renderToString(ui.jsx(Missing, {}))
console.log(html.html)
`,
  title: 'Rendering an undefined component fails',
})

add('components', 'jsx_invalid_attribute_expression_fail', {
  status: 'fail',
  source: `const x = <div class={1 + }>text</div>
console.log(x)
`,
  title: 'Invalid JSX attribute expression fails',
})

add('error_globals', 'json_parse_invalid_fail', {
  status: 'fail',
  source: `const parsed = JSON.parse("not json")
console.log(parsed)
`,
  title: 'JSON.parse on invalid input fails',
})

add('error_globals', 'math_wrong_arg_type', {
  status: 'pass',
  source: `console.log(Math.sqrt("four"))
`,
  title: 'Math.sqrt with wrong argument type',
})

add('async', 'async_function', {
  status: 'pass',
  source: `async fn fetch(): Promise<string> {
  return "data"
}
const result = fetch()
console.log("ok")
`,
  title: 'Async function declaration',
})

add('async', 'await_promise', {
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
  title: 'Await a promise',
})

add('async', 'await_outside_async_fail', {
  status: 'fail',
  source: `const x = await 1
console.log(x)
`,
  title: 'Await outside an async function fails',
})

// --- unsafe / JS interop ---

add('unsafe', 'unsafe_arithmetic_ok', {
  status: 'pass',
  source: `const r = unsafe { 2 + 3 }
console.log(r.__case)
console.log(r.value)
`,
  title: 'unsafe block returns Result.Ok for plain arithmetic',
})

add('unsafe', 'unsafe_panic_err', {
  status: 'pass',
  source: `const r = unsafe { deka.panic("boom") }
console.log(r.__case)
console.log(r.error.message)
`,
  title: 'unsafe block returns Result.Err on thrown error',
})

add('unsafe', 'unsafe_catch_rejected_fail', {
  status: 'fail',
  source: `const r = unsafe { 1 } catch (e) { 2 }
console.log(r)
`,
  title: 'Explicit catch clause is rejected in unsafe',
})

// ---------------------------------------------------------------------------
// Generate all tests
// ---------------------------------------------------------------------------

for (const { category, name, def } of tests) {
  await writeTest(category, name, def)
}

console.log(`[hats] generated ${tests.length} tests`)
