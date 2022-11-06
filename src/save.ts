import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";

import { cleanBin, cleanGit, cleanRegistry, cleanTargetDir } from "./cleanup";
import { CacheConfig, STATE_KEY } from "./config";

process.on("uncaughtException", (e) => {
  core.info(`[warning] ${e.message}`);
  if (e.stack) {
    core.info(e.stack);
  }
});

async function run() {
  const save = core.getInput("save-if").toLowerCase() || "true";

  if (!(cache.isFeatureAvailable() && save === "true")) {
    return;
  }

  try {
    const config = await CacheConfig.new();
    config.printInfo();
    core.info("");

    if (core.getState(STATE_KEY) === config.cacheKey) {
      core.info(`Cache up-to-date.`);
      return;
    }

    // TODO: remove this once https://github.com/actions/toolkit/pull/553 lands
    await macOsWorkaround();

    const allPackages = [];
    for (const workspace of config.workspaces) {
      const packages = await workspace.getPackages();
      allPackages.push(...packages);
      try {
        core.info(`... Cleaning ${workspace.target} ...`);
        await cleanTargetDir(workspace.target, packages);
      } catch (e) {
        core.info(`[warning] ${(e as any).stack}`);
      }
    }

    try {
      core.info(`... Cleaning cargo registry ...`);
      await cleanRegistry(allPackages);
    } catch (e) {
      core.info(`[warning] ${(e as any).stack}`);
    }

    try {
      core.info(`... Cleaning cargo/bin ...`);
      await cleanBin();
    } catch (e) {
      core.info(`[warning] ${(e as any).stack}`);
    }

    try {
      core.info(`... Cleaning cargo git cache ...`);
      await cleanGit(allPackages);
    } catch (e) {
      core.info(`[warning] ${(e as any).stack}`);
    }

    core.info(`... Saving cache ...`);
    await cache.saveCache(config.cachePaths, config.cacheKey);
  } catch (e) {
    core.info(`[warning] ${(e as any).stack}`);
  }
}

run();

async function macOsWorkaround() {
  try {
    // Workaround for https://github.com/actions/cache/issues/403
    // Also see https://github.com/rust-lang/cargo/issues/8603
    await exec.exec("sudo", ["/usr/sbin/purge"], { silent: true });
  } catch {}
}
