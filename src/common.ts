import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as glob from "@actions/glob";
import * as io from "@actions/io";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

process.on("uncaughtException", (e) => {
  core.info(`[warning] ${e.message}`);
  if (e.stack) {
    core.info(e.stack);
  }
});

const cwd = core.getInput("working-directory");

// Read each line of workspace-paths as a unique path
// TODO: this could be read from .cargo config file directly
const workspacePathsInput = core.getInput("workspace-paths") || "./";
const workspacePaths = workspacePathsInput.trim().split("\n");

if (cwd) {
  process.chdir(cwd);
}

export const stateBins = "RUST_CACHE_BINS";
export const stateKey = "RUST_CACHE_KEY";
const stateHash = "RUST_CACHE_HASH";

const home = os.homedir();
const cargoHome = process.env.CARGO_HOME || path.join(home, ".cargo");
export const paths = {
  cargoHome,
  index: path.join(cargoHome, "registry/index"),
  cache: path.join(cargoHome, "registry/cache"),
  git: path.join(cargoHome, "git"),
  workspaces: workspacePaths,
};

interface CacheConfig {
  // A list of common paths needing caching
  paths: Array<string>;
  key: string;
  restoreKeys: Array<string>;
  // A list of one or more workspace directories
  workspaces: Array<string>;
}

const RefKey = "GITHUB_REF";

export function isValidEvent(): boolean {
  return RefKey in process.env && Boolean(process.env[RefKey]);
}

export async function getCacheConfig(): Promise<CacheConfig> {
  let lockHash = core.getState(stateHash);
  if (!lockHash) {
    lockHash = await getLockfileHash();
    core.saveState(stateHash, lockHash);
  }

  let key = `v0-rust-`;

  const sharedKey = core.getInput("sharedKey");
  if (sharedKey) {
    key += `${sharedKey}-`;
  } else {
    const inputKey = core.getInput("key");
    if (inputKey) {
      key += `${inputKey}-`;
    }

    const job = process.env.GITHUB_JOB;
    if (job) {
      key += `${job}-`;
    }
  }

  key += await getRustKey();

  return {
    paths: [
      path.join(cargoHome, "bin"),
      path.join(cargoHome, ".crates2.json"),
      path.join(cargoHome, ".crates.toml"),
      paths.git,
      paths.cache,
      paths.index,
    ],
    key: `${key}-${lockHash}`,
    restoreKeys: [key],
    workspaces: paths.workspaces,
  };
}

export async function getCargoBins(): Promise<Set<string>> {
  try {
    const { installs }: { installs: { [key: string]: { bins: Array<string> } } } = JSON.parse(
      await fs.promises.readFile(path.join(paths.cargoHome, ".crates2.json"), "utf8"),
    );
    const bins = new Set<string>();
    for (const pkg of Object.values(installs)) {
      for (const bin of pkg.bins) {
        bins.add(bin);
      }
    }
    return bins;
  } catch {
    return new Set<string>();
  }
}

async function getRustKey(): Promise<string> {
  const rustc = await getRustVersion();
  return `${rustc.release}-${rustc.host}-${rustc["commit-hash"].slice(0, 12)}`;
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

export async function getCmdOutput(
  cmd: string,
  args: Array<string> = [],
  options: exec.ExecOptions = {},
): Promise<string> {
  let stdout = "";
  await exec.exec(cmd, args, {
    silent: true,
    listeners: {
      stdout(data) {
        stdout += data.toString();
      },
    },
    ...options,
  });
  return stdout;
}

async function getLockfileHash(): Promise<string> {
  const globber = await glob.create("**/Cargo.toml\n**/Cargo.lock\nrust-toolchain\nrust-toolchain.toml", {
    followSymbolicLinks: false,
  });
  const files = await globber.glob();
  core.debug("Lockfile Hash includes: " + JSON.stringify(files));
  files.sort((a, b) => a.localeCompare(b));

  const hasher = crypto.createHash("sha1");
  for (const file of files) {
    for await (const chunk of fs.createReadStream(file)) {
      hasher.update(chunk);
    }
  }
  return hasher.digest("hex").slice(0, 20);
}

export interface PackageDefinition {
  name: string;
  version: string;
  path: string;
  targets: Array<string>;
}

export type Packages = Array<PackageDefinition>;

interface Meta {
  packages: Array<{
    name: string;
    version: string;
    manifest_path: string;
    targets: Array<{ kind: Array<string>; name: string }>;
  }>;
}

export async function getPackages(workspacePaths: Array<string>): Promise<Packages> {
  const cwd = process.cwd();

  let allPackages: Packages = [];
  for (const workspacePath of workspacePaths) {
    process.chdir(workspacePath);
    const meta: Meta = JSON.parse(await getCmdOutput("cargo", ["metadata", "--all-features", "--format-version", "1"]));
    const workspacePackages = meta.packages
      .filter((p) => !p.manifest_path.startsWith(cwd))
      .map((p) => {
        const targets = p.targets.filter((t) => t.kind[0] === "lib").map((t) => t.name);
        return { name: p.name, version: p.version, targets, path: path.dirname(p.manifest_path) };
      });
    allPackages = allPackages.concat(workspacePackages);
  }

  process.chdir(cwd);
  return allPackages;
}

export async function cleanTarget(targetDir: string, packages: Packages) {
  await fs.promises.unlink(path.join(targetDir, "./.rustc_info.json"));

  await cleanProfileTarget(targetDir, packages, "debug");
  await cleanProfileTarget(targetDir, packages, "release");
}

async function cleanProfileTarget(targetDir: string, packages: Packages, profile: string) {
  try {
    await fs.promises.access(path.join(targetDir, profile));
  } catch {
    return;
  }

  await io.rmRF(path.join(targetDir, profile, "./examples"));
  await io.rmRF(path.join(targetDir, profile, "./incremental"));

  let dir: fs.Dir;
  // remove all *files* from the profile directory
  dir = await fs.promises.opendir(path.join(targetDir, profile));
  for await (const dirent of dir) {
    if (dirent.isFile()) {
      await rm(dir.path, dirent);
    }
  }

  const keepPkg = new Set(packages.map((p) => p.name));
  await rmExcept(path.join(targetDir, profile, "./build"), keepPkg);
  await rmExcept(path.join(targetDir, profile, "./.fingerprint"), keepPkg);

  const keepDeps = new Set(
    packages.flatMap((p) => {
      const names = [];
      for (const n of [p.name, ...p.targets]) {
        const name = n.replace(/-/g, "_");
        names.push(name, `lib${name}`);
      }
      return names;
    }),
  );
  await rmExcept(path.join(targetDir, profile, "./deps"), keepDeps);
}

const oneWeek = 7 * 24 * 3600 * 1000;

export async function rmExcept(dirName: string, keepPrefix: Set<string>) {
  const dir = await fs.promises.opendir(dirName);
  for await (const dirent of dir) {
    let name = dirent.name;
    const idx = name.lastIndexOf("-");
    if (idx !== -1) {
      name = name.slice(0, idx);
    }
    const fileName = path.join(dir.path, dirent.name);
    const { mtime } = await fs.promises.stat(fileName);
    // we don’t really know
    if (!keepPrefix.has(name) || Date.now() - mtime.getTime() > oneWeek) {
      await rm(dir.path, dirent);
    }
  }
}

export async function rm(parent: string, dirent: fs.Dirent) {
  try {
    const fileName = path.join(parent, dirent.name);
    core.debug(`deleting "${fileName}"`);
    if (dirent.isFile()) {
      await fs.promises.unlink(fileName);
    } else if (dirent.isDirectory()) {
      await io.rmRF(fileName);
    }
  } catch { }
}
