# Rust Cache Action

A GitHub Action that implements smart caching for rust/cargo projects with
sensible defaults.

## Example usage

```yaml
- uses: Swatinem/rust-cache@v1
```

### Registry Cache

- `~/.cargo/registry/index`
- `~/.cargo/registry/cache`

This cache is automatically keyed by hashing the `Cargo.lock` / `Cargo.toml`
files. Before persisting, the cache is cleaned of intermediate artifacts and
unneeded dependencies.

**TODO**: The `~/.cargo/git/db` database is not yet persisted, support will be
added at a later point.

### Target Cache

- `./target`

This cache is automatically keyed by:

- the github `job`,
- the rustc release / host / hash, and
- a hash of the `Cargo.lock` / `Cargo.toml` files.

Before persisting, the cache is cleaned of anything that is not a needed
dependency. In particular, no caching of workspace crates will be done. For
this reason, this action will automatically set `CARGO_INCREMENTAL=0` to
disable incremental compilation.
