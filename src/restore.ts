import * as core from "@actions/core";

import { cleanTargetDir } from "./cleanup";
import { CacheConfig } from "./config";
import { CacheProvider, getCacheProvider, reportError } from "./utils";

process.on("uncaughtException", (e) => {
  core.error(e.message);
  if (e.stack) {
    core.error(e.stack);
  }
});

async function run() {
  const cacheProvider = await getCacheProvider();

  if (!cacheProvider.cache.isFeatureAvailable()) {
    setCacheHitOutput(false);
    return;
  }

  try {
    let cacheOnFailure = core.getInput("cache-on-failure").toLowerCase();
    if (cacheOnFailure !== "true") {
      cacheOnFailure = "false";
    }
    const lookupOnly = core.getInput("lookup-only").toLowerCase() === "true";

    core.exportVariable("CACHE_ON_FAILURE", cacheOnFailure);
    core.exportVariable("CARGO_INCREMENTAL", 0);

    const config = await CacheConfig.new();
    config.printInfo(cacheProvider);
    core.info("");

    core.info(`... ${lookupOnly ? "Checking" : "Restoring"} cache ...`);
    const cacheResult = await restoreCache(cacheProvider, config.cachePaths, config.cacheKey, [config.restoreKey], lookupOnly);
    config.cacheNeedsSave = !cacheResult.match;
    if (config.targetCacheEnabled) {
      if (cacheResult.found && !cacheResult.match) {
        // pre-clean the target directory on cargo cache mismatch before restoring target cache
        await cleanTargets(config);
      }

      const targetResult = await restoreCache(
        cacheProvider,
        config.targetCachePaths,
        config.targetCacheKey,
        config.targetRestoreKeys,
        lookupOnly,
        "target",
      );
      config.targetCacheNeedsSave = !targetResult.match;
      if (targetResult.found && !targetResult.match) {
        // pre-clean the target directory on target cache mismatch
        await cleanTargets(config);
      }

      if (!cacheResult.match || !targetResult.match) {
        config.saveState();
      }

      setCacheHitOutput(cacheResult.match && targetResult.match);
    } else if (cacheResult.match) {
      setCacheHitOutput(true);
    } else {
      if (cacheResult.found) {
        // pre-clean the target directory on cache mismatch
        await cleanTargets(config);
      }

      config.saveState();
      setCacheHitOutput(false);
    }
  } catch (e) {
    setCacheHitOutput(false);

    reportError(e);
  }
  process.exit();
}

function setCacheHitOutput(cacheHit: boolean): void {
  core.setOutput("cache-hit", cacheHit.toString());
}

async function restoreCache(
  cacheProvider: CacheProvider,
  paths: string[],
  key: string,
  restoreKeys: string[],
  lookupOnly: boolean,
  name = "",
): Promise<RestoreResult> {
  const label = name ? `${name} cache` : "cache";
  // Pass a copy of cachePaths to avoid mutating the original array as reported by:
  // https://github.com/actions/toolkit/pull/1378
  // TODO: remove this once the underlying bug is fixed.
  const restoreKey = await cacheProvider.cache.restoreCache(paths.slice(), key, restoreKeys, {
    lookupOnly,
  });
  if (!restoreKey) {
    core.info(`No ${label} found.`);
    return { found: false, match: false };
  }

  const match =
    restoreKey.localeCompare(key, undefined, {
      sensitivity: "accent",
    }) === 0;
  core.info(`${lookupOnly ? "Found" : "Restored from"} ${label} key "${restoreKey}" full match: ${match}.`);
  return { found: true, match };
}

interface RestoreResult {
  found: boolean;
  match: boolean;
}

async function cleanTargets(config: CacheConfig) {
  for (const workspace of config.workspaces) {
    try {
      await cleanTargetDir(workspace.target, [], true);
    } catch {}
  }
}

run();
