import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as glob from "@actions/glob";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const home = os.homedir();
export const paths = {
  index: path.join(home, ".cargo/registry/index"),
  cache: path.join(home, ".cargo/registry/cache"),
  git: path.join(home, ".cargo/git/db"),
  target: "target",
};

export interface CacheConfig {
  path: string;
  key: string;
  restoreKeys?: Array<string>;
}

export interface Caches {
  index: CacheConfig;
  cache: CacheConfig;
  git: CacheConfig;
  target: CacheConfig;
}

const RefKey = "GITHUB_REF";

export function isValidEvent(): boolean {
  return RefKey in process.env && Boolean(process.env[RefKey]);
}

export async function getCaches(): Promise<Caches> {
  const rustKey = await getRustKey();
  let lockHash = core.getState("lockHash");
  if (!lockHash) {
    lockHash = await getLockfileHash();
    core.saveState("lockHash", lockHash);
  }
  let targetKey = core.getInput("key");
  if (targetKey) {
    targetKey = `${targetKey}-`;
  }
  return {
    index: { path: paths.index, key: "registry-index-XXX", restoreKeys: ["registry-index"] },
    cache: { path: paths.cache, key: `registry-cache-${lockHash}`, restoreKeys: ["registry-cache"] },
    git: { path: paths.git, key: "git-db" },
    target: {
      path: paths.target,
      key: `target-${targetKey}${rustKey}-${lockHash}`,
      restoreKeys: [`target-${targetKey}${rustKey}`],
    },
  };
}

export async function getRustKey(): Promise<string> {
  const rustc = await getRustVersion();
  return `${rustc.release}-${rustc.host}-${rustc["commit-hash"]}`;
}

interface RustVersion {
  host: string;
  release: string;
  "commit-hash": string;
}

export async function getRustVersion(): Promise<RustVersion> {
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

export async function getRegistryName() {
  const globber = await glob.create(`${paths.index}/**/.last-updated`, { followSymbolicLinks: false });
  const files = await globber.glob();
  if (files.length > 1) {
    core.debug(`got multiple registries: "${files.join('", "')}"`);
  }

  const first = files.shift();
  if (!first) {
    return;
  }
  return path.basename(path.dirname(first));
}

export async function getLockfileHash() {
  const globber = await glob.create("**/Cargo.toml\n**/Cargo.lock", { followSymbolicLinks: false });
  const files = await globber.glob();
  files.sort((a, b) => a.localeCompare(b));

  const hasher = crypto.createHash("sha1");
  for (const file of files) {
    for await (const chunk of fs.createReadStream(file)) {
      hasher.update(chunk);
    }
  }
  return hasher.digest("hex");
}
