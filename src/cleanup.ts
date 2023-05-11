import * as core from "@actions/core";
import * as io from "@actions/io";
import fs from "fs";
import path from "path";

import { CARGO_HOME, STATE_BINS } from "./config";
import { Packages } from "./workspace";

export async function cleanTargetDir(targetDir: string, packages: Packages, checkTimestamp = false) {
  core.debug(`cleaning target directory "${targetDir}"`);

  // remove all *files* from the profile directory
  let dir = await fs.promises.opendir(targetDir);
  for await (const dirent of dir) {
    if (dirent.isDirectory()) {
      let dirName = path.join(dir.path, dirent.name);
      // is it a profile dir, or a nested target dir?
      let isNestedTarget =
        (await exists(path.join(dirName, "CACHEDIR.TAG"))) || (await exists(path.join(dirName, ".rustc_info.json")));

      try {
        if (isNestedTarget) {
          await cleanTargetDir(dirName, packages, checkTimestamp);
        } else {
          await cleanProfileTarget(dirName, packages, checkTimestamp);
        }
      } catch {}
    } else if (dirent.name !== "CACHEDIR.TAG") {
      await rm(dir.path, dirent);
    }
  }
}

async function cleanProfileTarget(profileDir: string, packages: Packages, checkTimestamp = false) {
  core.debug(`cleaning profile directory "${profileDir}"`);

  let keepProfile = new Set(["build", ".fingerprint", "deps"]);
  await rmExcept(profileDir, keepProfile);

  const keepPkg = new Set(packages.map((p) => p.name));
  await rmExcept(path.join(profileDir, "build"), keepPkg, checkTimestamp);
  await rmExcept(path.join(profileDir, ".fingerprint"), keepPkg, checkTimestamp);

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
  await rmExcept(path.join(profileDir, "deps"), keepDeps, checkTimestamp);
}

export async function getCargoBins(): Promise<Set<string>> {
  const bins = new Set<string>();
  try {
    const { installs }: { installs: { [key: string]: { bins: Array<string> } } } = JSON.parse(
      await fs.promises.readFile(path.join(CARGO_HOME, ".crates2.json"), "utf8"),
    );
    for (const pkg of Object.values(installs)) {
      for (const bin of pkg.bins) {
        bins.add(bin);
      }
    }
  } catch {}
  return bins;
}

export async function cleanBin() {
  const bins = await getCargoBins();
  const oldBins = JSON.parse(core.getState(STATE_BINS));

  for (const bin of oldBins) {
    bins.delete(bin);
  }

  const dir = await fs.promises.opendir(path.join(CARGO_HOME, "bin"));
  for await (const dirent of dir) {
    if (dirent.isFile() && !bins.has(dirent.name)) {
      await rm(dir.path, dirent);
    }
  }
}

export async function cleanRegistry(packages: Packages, crates = true) {
  // `.cargo/registry/src`
  // we can remove this completely, as cargo will recreate this from `cache`
  await rmRF(path.join(CARGO_HOME, "registry", "src"));

  // `.cargo/registry/index`
  const indexDir = await fs.promises.opendir(path.join(CARGO_HOME, "registry", "index"));
  for await (const dirent of indexDir) {
    if (dirent.isDirectory()) {
      // eg `.cargo/registry/index/github.com-1ecc6299db9ec823`
      // or `.cargo/registry/index/index.crates.io-e139d0d48fed7772`
      const dirPath = path.join(indexDir.path, dirent.name);

      // for a git registry, we can remove `.cache`, as cargo will recreate it from git
      if (await exists(path.join(dirPath, ".git"))) {
        await rmRF(path.join(dirPath, ".cache"));
      }
      // TODO: else, clean `.cache` based on the `packages`
    }
  }

  if (!crates) {
    core.debug(`skipping crate cleanup`);
    return;
  }

  const pkgSet = new Set(packages.map((p) => `${p.name}-${p.version}.crate`));

  // `.cargo/registry/cache`
  const cacheDir = await fs.promises.opendir(path.join(CARGO_HOME, "registry", "cache"));
  for await (const dirent of cacheDir) {
    if (dirent.isDirectory()) {
      // eg `.cargo/registry/cache/github.com-1ecc6299db9ec823`
      // or `.cargo/registry/cache/index.crates.io-e139d0d48fed7772`
      const dir = await fs.promises.opendir(path.join(cacheDir.path, dirent.name));
      for await (const dirent of dir) {
        // here we check that the downloaded `.crate` matches one from our dependencies
        if (dirent.isFile() && !pkgSet.has(dirent.name)) {
          await rm(dir.path, dirent);
        }
      }
    }
  }
}

export async function cleanGit(packages: Packages) {
  const coPath = path.join(CARGO_HOME, "git", "checkouts");
  const dbPath = path.join(CARGO_HOME, "git", "db");
  const repos = new Map<string, Set<string>>();
  for (const p of packages) {
    if (!p.path.startsWith(coPath)) {
      continue;
    }
    const [repo, ref] = p.path.slice(coPath.length + 1).split(path.sep);
    const refs = repos.get(repo);
    if (refs) {
      refs.add(ref);
    } else {
      repos.set(repo, new Set([ref]));
    }
  }

  // we have to keep both the clone, and the checkout, removing either will
  // trigger a rebuild

  // clean the db
  try {
    let dir = await fs.promises.opendir(dbPath);
    for await (const dirent of dir) {
      if (!repos.has(dirent.name)) {
        await rm(dir.path, dirent);
      }
    }
  } catch {}

  // clean the checkouts
  try {
    let dir = await fs.promises.opendir(coPath);
    for await (const dirent of dir) {
      const refs = repos.get(dirent.name);
      if (!refs) {
        await rm(dir.path, dirent);
        continue;
      }
      if (!dirent.isDirectory()) {
        continue;
      }
      const refsDir = await fs.promises.opendir(path.join(dir.path, dirent.name));
      for await (const dirent of refsDir) {
        if (!refs.has(dirent.name)) {
          await rm(refsDir.path, dirent);
        }
      }
    }
  } catch {}
}

const ONE_WEEK = 7 * 24 * 3600 * 1000;

/**
 * Removes all files or directories in `dirName` matching some criteria.
 * 
 * When the `checkTimestamp` flag is set, this will also remove anything older
 * than one week.
 * 
 * Otherwise, it will remove everything that does not match any string in the
 * `keepPrefix` set.
 * The matching strips and trailing `-$hash` suffix.
 */
async function rmExcept(dirName: string, keepPrefix: Set<string>, checkTimestamp = false) {
  const dir = await fs.promises.opendir(dirName);
  for await (const dirent of dir) {
    if (checkTimestamp) {
      const fileName = path.join(dir.path, dirent.name);
      const { mtime } = await fs.promises.stat(fileName);
      const isOutdated = Date.now() - mtime.getTime() > ONE_WEEK;

      if (isOutdated) {
        await rm(dir.path, dirent);
      }
      return;
    }

    let name = dirent.name;

    // strip the trailing hash
    const idx = name.lastIndexOf("-");
    if (idx !== -1) {
      name = name.slice(0, idx);
    }

    if (!keepPrefix.has(name)) {
      await rm(dir.path, dirent);
    }
  }
}

async function rm(parent: string, dirent: fs.Dirent) {
  try {
    const fileName = path.join(parent, dirent.name);
    core.debug(`deleting "${fileName}"`);
    if (dirent.isFile()) {
      await fs.promises.unlink(fileName);
    } else if (dirent.isDirectory()) {
      await io.rmRF(fileName);
    }
  } catch {}
}

async function rmRF(dirName: string) {
  core.debug(`deleting "${dirName}"`);
  await io.rmRF(dirName);
}

async function exists(path: string) {
  try {
    await fs.promises.access(path);
    return true;
  } catch {
    return false;
  }
}
