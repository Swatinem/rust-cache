# Changelog

## 2.0.2

- Avoid calling `cargo metadata` on pre-cleanup.

## 2.0.1

- Primarily just updating dependencies to fix GitHub deprecation notices.

## 2.0.0

- The action code was refactored to allow for caching multiple workspaces and
  different `target` directory layouts.
- The `working-directory` and `target-dir` input options were replaced by a
  single `workspaces` option that has the form of `$workspace -> $target`.
- Support for considering `env-vars` as part of the cache key.
- The `sharedKey` input option was renamed to `shared-key` for consistency.

## 1.4.0

- Clean both `debug` and `release` target directories.

## 1.3.0

- Use Rust toolchain file as additional cache key.
- Allow for a configurable target-dir.

## 1.2.0

- Cache `~/.cargo/bin`.
- Support for custom `$CARGO_HOME`.
- Add a `cache-hit` output.
- Add a new `sharedKey` option that overrides the automatic job-name based key.

## 1.1.0

- Add a new `working-directory` input.
- Support caching git dependencies.
- Lots of other improvements.

## 1.0.2

- Don’t prune targets that have a different name from the crate, but do prune targets from the workspace.

## 1.0.1

- Improved logging output.
- Make sure to consider `all-features` dependencies when pruning.
- Work around macOS cache corruption.
- Remove git-db cache for now.
