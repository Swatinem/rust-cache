import * as core from "@actions/core";
import * as exec from "@actions/exec";

import { cleanBin, cleanGit, cleanRegistry, cleanTargetDir } from "./cleanup";
import { CacheConfig, isCacheUpToDate } from "./config";
import { getCacheProvider, reportError } from "./utils";
import { rm } from "fs/promises";
import fs from "fs";
import path from "path";

process.on("uncaughtException", (e) => {
  core.error(e.message);
  if (e.stack) {
    core.error(e.stack);
  }
});

async function run() {
  const cacheProvider = getCacheProvider();

  const save = core.getInput("save-if").toLowerCase() || "true";

  if (!(cacheProvider.cache.isFeatureAvailable() && save === "true")) {
    return;
  }

  try {
    if (isCacheUpToDate()) {
      core.info(`Cache up-to-date.`);
      return;
    }

    const config = CacheConfig.fromState();
    config.printInfo(cacheProvider);
    core.info("");

    // TODO: remove this once https://github.com/actions/toolkit/pull/553 lands
    if (process.env["RUNNER_OS"] == "macOS") {
      await macOsWorkaround();
    }

    // Save the incremental cache before we delete it
    if (config.incremental) {
      core.info(`... Saving incremental cache ...`);
      core.debug(`paths include ${config.incrementalPaths} with key ${config.incrementalKey}`);
      for (const paths of config.incrementalPaths) {
        await saveIncrementalDirs(paths);
      }
      await cacheProvider.cache.saveCache(config.incrementalPaths.slice(), config.incrementalKey);
      for (const path of config.incrementalPaths) {
        core.debug(`  deleting ${path}`);
        await rm(path);
      }
    }

    const allPackages = [];
    for (const workspace of config.workspaces) {
      const packages = await workspace.getPackagesOutsideWorkspaceRoot();
      allPackages.push(...packages);
      try {
        core.info(`... Cleaning ${workspace.target} ...`);
        await cleanTargetDir(workspace.target, packages, false);
      } catch (e) {
        core.debug(`${(e as any).stack}`);
      }
    }

    try {
      const crates = core.getInput("cache-all-crates").toLowerCase() || "false";
      core.info(`... Cleaning cargo registry (cache-all-crates: ${crates}) ...`);
      await cleanRegistry(allPackages, crates !== "true");
    } catch (e) {
      core.debug(`${(e as any).stack}`);
    }

    if (config.cacheBin) {
      try {
        core.info(`... Cleaning cargo/bin ...`);
        await cleanBin(config.cargoBins);
      } catch (e) {
        core.debug(`${(e as any).stack}`);
      }
    }

    try {
      core.info(`... Cleaning cargo git cache ...`);
      await cleanGit(allPackages);
    } catch (e) {
      core.debug(`${(e as any).stack}`);
    }

    core.info(`... Saving cache with key ${config.cacheKey}`);
    // Pass a copy of cachePaths to avoid mutating the original array as reported by:
    // https://github.com/actions/toolkit/pull/1378
    // TODO: remove this once the underlying bug is fixed.
    await cacheProvider.cache.saveCache(config.cachePaths.slice(), config.cacheKey);

  } catch (e) {
    reportError(e);
  }
  process.exit();
}

run();

async function macOsWorkaround() {
  try {
    // Workaround for https://github.com/actions/cache/issues/403
    // Also see https://github.com/rust-lang/cargo/issues/8603
    await exec.exec("sudo", ["/usr/sbin/purge"], { silent: true });
  } catch { }
}


async function saveIncrementalDirs(profileDir: string) {
  // Traverse the incremental folder recursively and collect the modified times in a map
  const incrementalDir = path.join(profileDir, "incremental");
  const modifiedTimes = new Map<string, number>();
  const fillModifiedTimes = async (dir: string) => {
    const dirEntries = await fs.promises.opendir(dir);
    for await (const dirent of dirEntries) {
      if (dirent.isDirectory()) {
        await fillModifiedTimes(path.join(dir, dirent.name));
      } else {
        const fileName = path.join(dir, dirent.name);
        const { mtime } = await fs.promises.stat(fileName);
        modifiedTimes.set(fileName, mtime.getTime());
      }
    }
  };
  await fillModifiedTimes(incrementalDir);

  // Write the modified times to the incremental folder
  core.debug(`writing incremental-restore.json for ${incrementalDir} files`);
  for (const file of modifiedTimes.keys()) {
    core.debug(`  ${file} -> ${modifiedTimes.get(file)}`);
  }
  const contents = JSON.stringify({ modifiedTimes });
  await fs.promises.writeFile(path.join(incrementalDir, "incremental-restore.json"), contents);

}
