# Rust Cache Action

A GitHub Action that implements smart caching for rust/cargo projects with
sensible defaults.

## Example usage

```yaml
# selecting a toolchain either by action or manual `rustup` calls should happen
# before the plugin, as it uses the current rustc version as its cache key
- uses: actions-rs/toolchain@v1
  with:
    profile: minimal
    toolchain: stable

- uses: Swatinem/rust-cache@v1
```

## Inputs

: `key`
An optional key that is added to the automatic cache key.

: `sharedKey`
An additional key that is stable over multiple jobs.

: `working-directory`
The working directory the action operates in, is case the cargo project is not
located in the repo root.

## Cache Effectiveness

This action only caches the _dependencies_ of a crate, so is more effective if
the dependency / own code ratio is higher.

It is also most effective for repositories with a `Cargo.lock` file. Library
repositories with only a `Cargo.toml` file have limited benefits, as cargo will
_always_ use the most up-to-date dependency versions, which may not be cached.

Usage with Stable Rust is most effective, as a cache is tied to the Rust version.
Using it with Nightly Rust is less effective as it will throw away the cache every day.

## Versioning

I use the `v1` branch similar to `master` development, so if you want to have
a more stable experience, please use a fixed revision or tag.

## Cache Details

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
