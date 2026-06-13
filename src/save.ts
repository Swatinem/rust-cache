import * as core from "@actions/core";
import * as exec from "@actions/exec";

import { cleanBin, cleanGit, cleanRegistry, cleanTargetDir } from "./cleanup";
import { CacheConfig, isCacheUpToDate } from "./config";
import { CacheProvider, getCacheProvider, reportError } from "./utils";

process.on("uncaughtException", (e) => {
  core.error(e.message);
  if (e.stack) {
    core.error(e.stack);
  }
});

async function run() {
  const cacheProvider = await getCacheProvider();

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

    const cleanCargo = !config.targetCacheEnabled || config.cacheNeedsSave;
    const cleanTargets = !config.targetCacheEnabled || config.targetCacheNeedsSave;
    const workspaceCrates = core.getInput("cache-workspace-crates").toLowerCase() || "false";
    const allPackages = [];
    for (const workspace of config.workspaces) {
      const packages = await workspace.getPackagesOutsideWorkspaceRoot(config.cmdFormat);
      if (workspaceCrates === "true") {
        const wsMembers = await workspace.getWorkspaceMembers(config.cmdFormat);
        packages.push(...wsMembers);
      }
      allPackages.push(...packages);
      if (cleanTargets) {
        try {
          core.info(`... Cleaning ${workspace.target} ...`);
          await cleanTargetDir(workspace.target, packages);
        } catch (e) {
          core.debug(`${(e as any).stack}`);
        }
      }
    }

    if (cleanCargo) {
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
    }

    if (config.targetCacheEnabled) {
      if (config.cacheNeedsSave) {
        core.info(`... Saving cargo cache ...`);
        await saveCache(cacheProvider, config.cachePaths, config.cacheKey);
      } else {
        core.info(`Cargo cache up-to-date.`);
      }

      if (config.targetCacheNeedsSave) {
        core.info(`... Saving target cache ...`);
        await saveCache(cacheProvider, config.targetCachePaths, config.targetCacheKey);
      } else {
        core.info(`Target cache up-to-date.`);
      }
    } else {
      core.info(`... Saving cache ...`);
      await saveCache(cacheProvider, config.cachePaths, config.cacheKey);
    }
  } catch (e) {
    reportError(e);
  }
  process.exit();
}

run();

async function saveCache(cacheProvider: CacheProvider, paths: string[], key: string) {
  // Pass a copy of cachePaths to avoid mutating the original array as reported by:
  // https://github.com/actions/toolkit/pull/1378
  // TODO: remove this once the underlying bug is fixed.
  await cacheProvider.cache.saveCache(paths.slice(), key);
}

async function macOsWorkaround() {
  try {
    // Workaround for https://github.com/actions/cache/issues/403
    // Also see https://github.com/rust-lang/cargo/issues/8603
    await exec.exec("sudo", ["/usr/sbin/purge"], { silent: true });
  } catch {}
}
