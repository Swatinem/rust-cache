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

interface CacheConfig {
  name: string;
  paths: Array<string>;
  key: string;
  restoreKeys?: Array<string>;
}

interface Caches {
  registry: CacheConfig;
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
  const job = process.env.GITHUB_JOB;
  if (job) {
    targetKey = `${job}-${targetKey}`;
  }

  const registry = `v0-registry`;
  const target = `v0-target-${targetKey}${rustKey}`;
  return {
    registry: {
      name: "Registry",
      paths: [
        paths.index,
        paths.cache,
        // TODO: paths.git,
      ],
      key: `${registry}-${lockHash}`,
      restoreKeys: [registry],
    },
    target: {
      name: "Target",
      paths: [paths.target],
      key: `${target}-${lockHash}`,
      restoreKeys: [target],
    },
  };
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

export async function getRegistryName(): Promise<string> {
  const globber = await glob.create(`${paths.index}/**/.last-updated`, { followSymbolicLinks: false });
  const files = await globber.glob();
  if (files.length > 1) {
    core.warning(`got multiple registries: "${files.join('", "')}"`);
  }

  const first = files.shift()!;
  return path.basename(path.dirname(first));
}

async function getLockfileHash(): Promise<string> {
  const globber = await glob.create("**/Cargo.toml\n**/Cargo.lock", { followSymbolicLinks: false });
  const files = await globber.glob();
  files.sort((a, b) => a.localeCompare(b));

  const hasher = crypto.createHash("sha1");
  for (const file of files) {
    for await (const chunk of fs.createReadStream(file)) {
      hasher.update(chunk);
    }
  }
  return hasher.digest("hex").slice(0, 20);
}
