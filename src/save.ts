import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as io from "@actions/io";
import fs from "fs";
import path from "path";
import { getCaches, getCmdOutput, getRegistryName, isValidEvent, paths } from "./common";

async function run() {
  if (!isValidEvent()) {
    //return;
  }

  try {
    const caches = await getCaches();
    const registryName = await getRegistryName();
    const packages = await getPackages();

    await pruneTarget(packages);
    if (registryName) {
      // save the index based on its revision
      const indexRef = await getIndexRef(registryName);
      caches.index.key = `registry-index-${indexRef}`;
      await io.rmRF(path.join(paths.index, registryName, ".cache"));

      await pruneRegistryCache(registryName, packages);
    } else {
      delete (caches as any).index;
      delete (caches as any).cache;
    }

    for (const [type, { name, path, key }] of Object.entries(caches)) {
      if (core.getState(type) === key) {
        core.info(`${name} up-to-date.`);
        continue;
      }
      try {
        core.startGroup(`Saving ${name}…`);
        core.info(`Saving path "${path}".`);
        core.info(`Using key "${key}".`);
        await cache.saveCache([path], key);
      } catch (e) {
        core.info(`[warning] ${e.message}`);
      } finally {
        core.endGroup();
      }
    }
  } catch (e) {
    core.info(`[warning] ${e.message}`);
  }
}

run();

async function getIndexRef(registryName: string) {
  const cwd = path.join(paths.index, registryName);
  return (await getCmdOutput("git", ["rev-parse", "--short", "origin/master"], { cwd })).trim();
}

interface PackageDefinition {
  name: string;
  version: string;
}

type Packages = Array<PackageDefinition>;

async function getPackages(): Promise<Packages> {
  const meta = JSON.parse(await getCmdOutput("cargo", ["metadata", "--all-features", "--format-version", "1"]));
  return meta.packages.map(({ name, version }: any) => ({ name, version }));
}

async function pruneRegistryCache(registryName: string, packages: Packages) {
  const pkgSet = new Set(packages.map((p) => `${p.name}-${p.version}.crate`));

  const dir = await fs.promises.opendir(path.join(paths.cache, registryName));
  for await (const dirent of dir) {
    if (dirent.isFile() && !pkgSet.has(dirent.name)) {
      const fileName = path.join(dir.path, dirent.name);
      await fs.promises.unlink(fileName);
      core.debug(`deleting "${fileName}"`);
    }
  }
}

async function pruneTarget(packages: Packages) {
  await fs.promises.unlink("./target/.rustc_info.json");
  await io.rmRF("./target/debug/examples");
  await io.rmRF("./target/debug/incremental");
  let dir: fs.Dir;

  // remove all *files* from debug
  dir = await fs.promises.opendir("./target/debug");
  for await (const dirent of dir) {
    if (dirent.isFile()) {
      const fileName = path.join(dir.path, dirent.name);
      await fs.promises.unlink(fileName);
    }
  }

  const keepPkg = new Set(packages.map((p) => p.name));
  await rmExcept("./target/debug/build", keepPkg);
  await rmExcept("./target/debug/.fingerprint", keepPkg);

  const keepDeps = new Set(
    packages.flatMap((p) => {
      const name = p.name.replace(/-/g, "_");
      return [name, `lib${name}`];
    }),
  );
  await rmExcept("./target/debug/deps", keepDeps);
}

const twoWeeks = 14 * 24 * 3600 * 1000;

async function rmExcept(dirName: string, keepPrefix: Set<string>) {
  const dir = await fs.promises.opendir(dirName);
  for await (const dirent of dir) {
    let name = dirent.name;
    const idx = name.lastIndexOf("-");
    if (idx !== -1) {
      name = name.slice(0, idx);
    }
    const fileName = path.join(dir.path, dirent.name);
    const { mtime } = await fs.promises.stat(fileName);
    if (!keepPrefix.has(name) || Date.now() - mtime.getTime() > twoWeeks) {
      core.debug(`deleting "${fileName}"`);
      if (dirent.isFile()) {
        await fs.promises.unlink(fileName);
      } else if (dirent.isDirectory()) {
        await io.rmRF(fileName);
      }
    }
  }
}
