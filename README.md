# deka test suite

The **website** for public DekaScript conformance: **https://testsuite.deka.gg**

Fixtures live in [`dekaruntime/deka`](https://github.com/dekaruntime/deka) at
`tests/testsuite/`. This repo displays them. See [deka#292](https://github.com/dekaruntime/deka/issues/292).

## How it works

- Open a case → edit and run in the visitor’s browser (WASM). Still live.
- **CACHED RESULTS** for native-only / packages / recorded-only: a recording
  from the last dump, not a live Worker.
- The grid is dump-time. Pink means the two hosts disagreed when deka dumped.

CI does **not** re-run 620 tests and does not launch Chromium. It fills in the
conformance pack from `https://wasm.deka.gg/latest/conformance/` (or the last
published dump), then `next build` + deploy.

## Adding a test

Add a Hats folder in **deka**:

```
tests/testsuite/<category>/<name>/
  <name>.pass.ds | <name>.fail.ds
  <name>.stdout / <name>.code / <name>.json
```

Then `./run.sh --filter <name>` in the deka checkout. After the next runtime
release, this site ingests the new tree + dump.

Native-only stdlib package categories (`crypto`, `jwt`, `json`, `fs`, `tcp`, `tls`,
`http`, `time`) are listed in `lib/recorded-only.ts` so they show as **CACHED RESULTS**
once the dump includes them. Fixtures for those live in deka, not here.

## Local

```sh
bun install
bun scripts/ingest.mjs
bun run dev
```

To ingest a local deka dump:

```sh
DEKA_REPO=/path/to/deka bun scripts/ingest.mjs
```
