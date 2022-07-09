import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as glob from "@actions/glob";
import path from "path";

import { cleanBin, cleanGit, cleanRegistry, cleanTargetDir } from "./cleanup";
import { CacheConfig, STATE_KEY } from "./config";

process.on("uncaughtException", (e) => {
  core.info(`[warning] ${e.message}`);
  if (e.stack) {
    core.info(e.stack);
  }
});

async function run() {
  if (!cache.isFeatureAvailable()) {
    return;
  }

  try {
    const config = await CacheConfig.new();

    if (core.getState(STATE_KEY) === config.cacheKey) {
      core.info(`Cache up-to-date.`);
      return;
    }

    // TODO: remove this once https://github.com/actions/toolkit/pull/553 lands
    await macOsWorkaround();

    const registryName = await getRegistryName(config);

    const allPackages = [];
    for (const workspace of config.workspaces) {
      const packages = await workspace.getPackages();
      allPackages.push(...packages);
      try {
        await cleanTargetDir(workspace.target, packages);
      } catch (e) {
        core.info(`[warning] ${(e as any).stack}`);
      }
    }

    if (registryName) {
      try {
        await cleanRegistry(config, registryName, allPackages);
      } catch (e) {
        core.info(`[warning] ${(e as any).stack}`);
      }
    }

    try {
      await cleanBin(config);
    } catch (e) {
      core.info(`[warning] ${(e as any).stack}`);
    }

    try {
      await cleanGit(config, allPackages);
    } catch (e) {
      core.info(`[warning] ${(e as any).stack}`);
    }

    core.info(`# Saving cache`);
    config.printInfo();
    await cache.saveCache(config.cachePaths, config.cacheKey);
  } catch (e) {
    core.info(`[warning] ${(e as any).stack}`);
  }
}

run();

async function getRegistryName(config: CacheConfig): Promise<string | null> {
  const globber = await glob.create(`${config.cargoIndex}/**/.last-updated`, { followSymbolicLinks: false });
  const files = await globber.glob();
  if (files.length > 1) {
    core.warning(`got multiple registries: "${files.join('", "')}"`);
  }

  const first = files.shift()!;
  if (!first) {
    return null;
  }
  return path.basename(path.dirname(first));
}

async function macOsWorkaround() {
  try {
    // Workaround for https://github.com/actions/cache/issues/403
    // Also see https://github.com/rust-lang/cargo/issues/8603
    await exec.exec("sudo", ["/usr/sbin/purge"], { silent: true });
  } catch {}
}
