# Rust Cache Action

A GitHub Action that implements smart caching for rust/cargo projects with
sensible defaults.

## Example usage

```yaml
- uses: actions/checkout@v2

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

: `target-dir`
The target directory that should be cleaned and persisted, defaults to `./target`.

: `cache-on-failure`
Cache even if the build fails, defaults to false

## Outputs

: `cache-hit`

This is a boolean flag that will be set to `true` when there was an exact cache hit.

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

This action currently caches the following files/directories:

- `~/.cargo/bin`
- `~/.cargo/registry/index`
- `~/.cargo/registry/cache`
- `~/.cargo/git`
- `~/.cargo/.crates.toml`
- `~/.cargo/.crates2.json`
- `./target`

This cache is automatically keyed by:

- the github [`job_id`](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_id),
- the rustc release / host / hash, and
- a hash of all `Cargo.lock` / `Cargo.toml` files found anywhere in the repository (if present).
- a hash of all `rust-toolchain` / `rust-toolchain.toml` files in the root of the repository (if present).

An additional input `key` can be provided if the builtin keys are not sufficient.

Before being persisted, the cache is cleaned of:
- Any files in `~/.cargo/bin` that were present before the action ran (for example `rustc`).
- Dependencies that are no longer used.
- Anything that is not a dependency.
- Incremental build artifacts.
- Any build artifacts with an `mtime` older than one week.

In particular, the workspace crates themselves are not cached since doing so is
[generally not effective](https://github.com/Swatinem/rust-cache/issues/37#issuecomment-944697938).
For this reason, this action automatically sets `CARGO_INCREMENTAL=0` to disable
incremental compilation, so that the Rust compiler doesn't waste time creating
the additional artifacts required for incremental builds.

The `~/.cargo/registry/src` directory is not cached since it is quicker for Cargo
to recreate it from the compressed crate archives in `~/.cargo/registry/cache`.

The action will try to restore from a previous `Cargo.lock` version as well, so
lockfile updates should only re-build changed dependencies.

Additionally, the action automatically works around
[cargo#8603](https://github.com/rust-lang/cargo/issues/8603) /
[actions/cache#403](https://github.com/actions/cache/issues/403) which would
otherwise corrupt the cache on macOS builds.

## Known issues

- The cache cleaning process currently only runs against the build artifacts under
  `./target/debug/`, so projects using release or cross-compiled builds will experience
  larger cache sizes.
