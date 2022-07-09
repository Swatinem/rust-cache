import * as core from "@actions/core";
import * as glob from "@actions/glob";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import { getCmdOutput } from "./utils";
import { Workspace } from "./workspace";

const STATE_LOCKFILE_HASH = "RUST_CACHE_LOCKFILE_HASH";
const STATE_LOCKFILES = "RUST_CACHE_LOCKFILES";
export const STATE_BINS = "RUST_CACHE_BINS";
export const STATE_KEY = "RUST_CACHE_KEY";

export class CacheConfig {
  /** All the paths we want to cache */
  public cachePaths: Array<string> = [];
  /** The primary cache key */
  public cacheKey = "";
  /** The secondary (restore) key that only contains the prefix and environment */
  public restoreKey = "";

  /** The `~/.cargo` directory */
  public cargoHome = "";
  /** The cargo registry index directory */
  public cargoIndex = "";
  /** The cargo registry cache directory */
  public cargoCache = "";
  /** The cargo git checkouts directory */
  public cargoGit = "";
  /** The workspace configurations */
  public workspaces: Array<Workspace> = [];

  /** The prefix portion of the cache key */
  private keyPrefix = "";
  /** The rust version considered for the cache key */
  private keyRust = "";
  /** The environment variables considered for the cache key */
  private keyEnvs: Array<string> = [];
  /** The files considered for the cache key */
  private keyFiles: Array<string> = [];

  private constructor() {}

  /**
   * Constructs a [`CacheConfig`] with all the paths and keys.
   *
   * This will read the action `input`s, and read and persist `state` as necessary.
   */
  static async new(): Promise<CacheConfig> {
    const self = new CacheConfig();

    // Construct key prefix:
    // This uses either the `sharedKey` input,
    // or the `key` input combined with the `job` key.

    let key = `v0-rust`;

    const sharedKey = core.getInput("sharedKey");
    if (sharedKey) {
      key += `-${sharedKey}`;
    } else {
      const inputKey = core.getInput("key");
      if (inputKey) {
        key += `-${inputKey}`;
      }

      const job = process.env.GITHUB_JOB;
      if (job) {
        key += `-${job}`;
      }
    }

    self.keyPrefix = key;

    // Construct environment portion of the key:
    // This consists of a hash that considers the rust version
    // as well as all the environment variables as given by a default list
    // and the `envVars` input.
    // The env vars are sorted, matched by prefix and hashed into the
    // resulting environment hash.

    let hasher = crypto.createHash("sha1");
    const rustVersion = await getRustVersion();

    let keyRust = `${rustVersion.release} ${rustVersion.host}`;
    hasher.update(keyRust);
    hasher.update(rustVersion["commit-hash"]);

    keyRust += ` (${rustVersion["commit-hash"]})`;
    self.keyRust = keyRust;

    // these prefixes should cover most of the compiler / rust / cargo keys
    const envPrefixes = ["CARGO", "CC", "CXX", "CMAKE", "RUST"];
    envPrefixes.push(...core.getInput("envVars").split(/\s+/).filter(Boolean));

    // sort the available env vars so we have a more stable hash
    const keyEnvs = [];
    const envKeys = Object.keys(process.env);
    envKeys.sort((a, b) => a.localeCompare(b));
    for (const key of envKeys) {
      const value = process.env[key];
      if (envPrefixes.some((prefix) => key.startsWith(prefix)) && value) {
        hasher.update(`${key}=${value}`);
        keyEnvs.push(key);
      }
    }

    self.keyEnvs = keyEnvs;
    key += `-${hasher.digest("hex")}`;

    self.restoreKey = key;

    // Construct the lockfiles portion of the key:
    // This considers all the files found via globbing for various manifests
    // and lockfiles.
    // This part is computed in the "pre"/"restore" part of the job and persisted
    // into the `state`. That state is loaded in the "post"/"save" part of the
    // job so we have consistent values even though the "main" actions run
    // might create/overwrite lockfiles.

    let lockHash = core.getState(STATE_LOCKFILE_HASH);
    let keyFiles: Array<string> = JSON.parse(core.getState(STATE_LOCKFILES) || "[]");

    if (!lockHash) {
      const globber = await glob.create("**/Cargo.toml\n**/Cargo.lock\nrust-toolchain\nrust-toolchain.toml", {
        followSymbolicLinks: false,
      });
      keyFiles = await globber.glob();
      keyFiles.sort((a, b) => a.localeCompare(b));

      hasher = crypto.createHash("sha1");
      for (const file of keyFiles) {
        for await (const chunk of fs.createReadStream(file)) {
          hasher.update(chunk);
        }
      }
      lockHash = hasher.digest("hex");

      core.saveState(STATE_LOCKFILE_HASH, lockHash);
      core.saveState(STATE_LOCKFILES, JSON.stringify(keyFiles));
    }

    self.keyFiles = keyFiles;
    key += `-${lockHash}`;
    self.cacheKey = key;

    // Constructs some generic paths, workspace config and paths to restore:
    // The workspaces are given using a `$workspace -> $target` syntax.

    const home = os.homedir();
    const cargoHome = process.env.CARGO_HOME || path.join(home, ".cargo");
    self.cargoHome = cargoHome;
    self.cargoIndex = path.join(cargoHome, "registry/index");
    self.cargoCache = path.join(cargoHome, "registry/cache");
    self.cargoGit = path.join(cargoHome, "git");

    const workspaces: Array<Workspace> = [];
    const workspacesInput = core.getInput("workspaces") || ".";
    for (const workspace of workspacesInput.trim().split("\n")) {
      let [root, target = "target"] = workspace.split(" -> ");
      root = path.resolve(root);
      target = path.join(root, target);
      workspaces.push(new Workspace(root, target));
    }
    self.workspaces = workspaces;

    self.cachePaths = [
      path.join(cargoHome, "bin"),
      path.join(cargoHome, ".crates2.json"),
      path.join(cargoHome, ".crates.toml"),
      self.cargoIndex,
      self.cargoCache,
      self.cargoGit,
      ...workspaces.map((ws) => ws.target),
    ];

    return self;
  }

  printInfo() {
    core.info(`Workspaces:`);
    for (const workspace of this.workspaces) {
      core.info(`    ${workspace.root}`);
    }
    core.info(`Cache Paths:`);
    for (const path of this.cachePaths) {
      core.info(`    ${path}`);
    }
    core.info(`Restore Key:`);
    core.info(`    ${this.restoreKey}`);
    core.info(`Cache Key:`);
    core.info(`    ${this.cacheKey}`);
    core.info(`.. Prefix:`);
    core.info(`  - ${this.keyPrefix}`);
    core.info(`.. Environment considered:`);
    core.info(`  - Rust Version: ${this.keyRust}`);
    for (const env of this.keyEnvs) {
      core.info(`  - ${env}`);
    }
    core.info(`.. Lockfiles considered:`);
    for (const file of this.keyFiles) {
      core.info(`  - ${file}`);
    }
  }

  public async getCargoBins(): Promise<Set<string>> {
    const bins = new Set<string>();
    try {
      const { installs }: { installs: { [key: string]: { bins: Array<string> } } } = JSON.parse(
        await fs.promises.readFile(path.join(this.cargoHome, ".crates2.json"), "utf8"),
      );
      for (const pkg of Object.values(installs)) {
        for (const bin of pkg.bins) {
          bins.add(bin);
        }
      }
    } catch {}
    return bins;
  }
}

interface RustVersion {
  host: string;
  release: string;
  "commit-hash": string;
}

async function getRustVersion(): Promise<RustVersion> {
  const stdout = await getCmdOutput("rustc", ["-vV"]);
  let splits = stdout
    .split(/[\n\r]+/)
    .filter(Boolean)
    .map((s) => s.split(":").map((s) => s.trim()))
    .filter((s) => s.length === 2);
  return Object.fromEntries(splits);
}
