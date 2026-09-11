# Repository guidelines

`corpus/` is the whole product of this repository. Keep application, website,
build, and deployment code out of it.

## Corpus changes

- Keep every fixture in `corpus/<category>/<case>/`.
- Include the source file and the expected output, exit code, or diagnostic
  fixture required by the corpus runner.
- Preserve the existing fixture naming convention in the category being
  changed.

## Release workflow

Every change lands through a pull request targeting `main`. Corpus tags are
created by the toolchain release owner; do not create a release tag from a
feature branch.
