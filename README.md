# Rust Cache Action

A GitHub Action that implements smart caching for rust/cargo projects with
sensible defaults.

## Example usage

```yaml
- uses: Swatinem/rust-cache@v1
```

### Cache Details

The cache currently caches the following directories:

- `~/.cargo/registry/index`
- `~/.cargo/registry/cache`
- `~/.cargo/git`
- `./target`

This cache is automatically keyed by:

- the github `job`,
- the rustc release / host / hash, and
- a hash of the `Cargo.lock` / `Cargo.toml` files.

An additional input `key` can be provided if the builtin keys are not sufficient.

Before persisting, the cache is cleaned of intermediate artifacts and
anything that is not a workspace dependency.
In particular, no caching of workspace crates will be done. For
this reason, this action will automatically set `CARGO_INCREMENTAL=0` to
disable incremental compilation.

The action will try to restore from a previous `Cargo.lock` version as well, so
lockfile updates should only re-build changed dependencies.

Additionally, the action automatically works around
[cargo#8603](https://github.com/rust-lang/cargo/issues/8603) /
[actions/cache#403](https://github.com/actions/cache/issues/403) which would
otherwise corrupt the cache on macOS builds.
