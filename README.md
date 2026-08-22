# deka test suite

Public conformance tests for [DekaScript](https://deka.gg).

Live site: **https://testsuite.deka.gg**

## How it works

Each test is its own folder under `tests/<category>/<test-name>/`:

```
tests/parser/missing_semicolon/
  missing_semicolon.fail.ds      # source under test
  missing_semicolon.stdout       # exact expected stdout (optional)
  missing_semicolon.code         # exact expected formatter output (optional)
  missing_semicolon.json         # title, stage, diagnostic, notes (optional)
```

The filename of the `.ds` file states whether the test should **pass** or **fail**:

- `<name>.pass.ds`
- `<name>.fail.ds`

## Adding a test

1. Fork the repo.
2. Create a new folder under `tests/<category>/<test-name>/`.
3. Add the `.ds` source file.
4. If the test checks stdout, add a `.stdout` file with the exact expected output.
5. If the test checks formatter output, add a `.code` file with the exact expected code.
6. Open a pull request.

## Exact matching

The suite uses exact string comparison for both stdout and formatted code. Every character matters, including trailing newlines. This makes it suitable for validating formatter behavior.

## JSON metadata format

```json
{
  "title": "Missing semicolon between struct fields",
  "stage": "parse",
  "hosts": ["native", "browser"],
  "expectedDiagnosticContains": "expected ';'",
  "notes": "Regression for formatter/tour corruption."
}
```

Optional JSON fields:

- `hosts` — `["native","browser"]` (default), or a single host for APIs that only exist there.
- `dekaJson` — security manifest copied next to the entry for `deka run`.

Fields:

- `title` — human-readable name shown in the UI.
- `stage` — `parse`, `typecheck`, or `run`.
- `expectedDiagnosticContains` — substring the compiler diagnostic must contain for failing tests.
- `notes` — free-form notes.

## Local development

```bash
bun install
bun run dev
```

Build a static export:

```bash
bun run build
```

### Helper scripts

Run one-off snippets against the live wasm compiler:

```bash
printf 'console.log("hello")\n' | bun scripts/quick-test.mjs
```

Dump the full build-time conformance report locally:

```bash
bun scripts/dump-results.mjs
```

Regenerate `.stdout` / `.code` / diagnostics from the loaded `tests/` tree (uses the native isolate for pass stdout, not Node):

```bash
bun scripts/regen-fixtures.mjs
bun scripts/regen-fixtures.mjs types
```

## Native vs browser hosts

Each fixture is a DekaScript program. The dump runs it on **Deka**, not on Node.

| Column | Compile | Execute |
|---|---|---|
| Native | CLI isolate | `deka run ./entry.ds` |
| Browser | WASM compiler | Chromium Worker (same sandbox as the tour) |

Pink / divergent means those two Deka hosts disagreed. A fixture can opt into one host via `"hosts": ["native"]` or `["browser"]` in its `.json`.

The grid on the site is dump-time, not live. Open a case to tinker in the browser. Cases that cannot run in the visitor's browser — `"hosts": ["native"]`, or anything listed in `lib/recorded-only.ts` — are read-only and labeled **CACHED RESULTS** (stdout + emitted JS from the last dump). That label means the page is a recording, not frozen or broken.

The dump downloads the published CLI and WASM matching `wasm.deka.gg/latest`, unless you point both at the same unreleased build:

```bash
DEKA_NATIVE=../deka/target/release/cli \
DEKA_WASM=../deka/target/wasm32-unknown-unknown/release/deka_compiler_wasm.wasm \
  bun scripts/dump-results.mjs
```

Dump and CI run on a self-hosted builder that can execute the native CLI and launch Chromium. GitHub-hosted Linux is not a substitute.

See [RFD 26](https://github.com/dekaruntime/rfd/issues/26).

## Deployment

The site deploys via Cloudflare Workers Builds automatically on every push to `main`.

Dashboard settings:

| Setting | Value |
|---|---|
| Build command | `bun run build` |
| Deploy command | `npx wrangler deploy --assets dist` |
| Root directory | `/` |

`next.config.ts` uses `output: 'export'` and `distDir: 'dist'`, so the build produces a static `dist/` folder. Wrangler uploads that folder as static assets with no Worker code.
