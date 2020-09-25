# Rust Cache Action

A GitHub Action that implements smart caching for rust/cargo projects

## Inputs

- `key` - An optional key for the `target` cache. This is useful in case you
  have different jobs for test / check / clippy, etc

## Example usage

```yaml
- uses: Swatinem/rust-cache@v1
  with:
    key: test
```

## Specifics

This action tries to be better than just caching the following directories:

```
~/.cargo/registry
~/.cargo/git
target
```

It disables incremental compilation and only caches dependencies. The
assumption is that we will likely recompile the own crate(s) anyway.

It also separates the cache into 4 groups, each treated differently:

- Index: `~/.cargo/registry/index/<registry>`:

  This is always restored from its latest snapshot, and persisted based on the
  most recent revision.

- Registry / Cache: `~/.cargo/registry/cache/<registry>`:

  Automatically keyed by the lockfile/toml hash, and is being pruned to only
  persist the dependencies that are being used.

- Registry / Git: `~/.cargo/registry/git/<registry>`:

  Automatically keyed by the lockfile/toml hash. Pruning is still TODO.

- target: `./target`

  Automatically keyed by the lockfile/toml hash, and is being pruned to only
  persist the dependencies that are being used. This is especially throwing
  away any intermediate artifacts.
