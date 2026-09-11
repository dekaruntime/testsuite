# Deka conformance corpus

This repository is the authoritative, versioned DekaScript conformance corpus.
The `deka` runtime and `dsc` compiler download a pinned tag archive and verify
its SHA-256 before running these fixtures.

## Layout

Each case lives under `corpus/<category>/<name>/` and includes its source plus
the expected result:

```
corpus/<category>/<name>/
  <name>.pass.ds | <name>.fail.ds
  <name>.stdout | <name>.code | <name>.json
```

This is a content-only repository. Website and runner code belong in their
own repositories; changes here are corpus changes only.

## Contribution and release

Open changes against `main`. Releases are immutable tags coordinated by the
toolchain release owner; consumers must update their reviewed tag and checksum
pin together.
