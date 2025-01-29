import * as core from "@actions/core";

import { cleanTargetDir } from "./cleanup";
import { CacheConfig } from "./config";
import { getCacheProvider, reportError } from "./utils";
import { restoreIncremental } from "./incremental";

process.on("uncaughtException", (e) => {
  core.error(e.message);
  if (e.stack) {
    core.error(e.stack);
  }
});

async function run() {
  const cacheProvider = getCacheProvider();

  if (!cacheProvider.cache.isFeatureAvailable()) {
    setCacheHitOutput(false);
    return;
  }

  try {
    var cacheOnFailure = core.getInput("cache-on-failure").toLowerCase();
    if (cacheOnFailure !== "true") {
      cacheOnFailure = "false";
    }
    var lookupOnly = core.getInput("lookup-only").toLowerCase() === "true";

    core.exportVariable("CACHE_ON_FAILURE", cacheOnFailure);

    const config = await CacheConfig.new();
    config.printInfo(cacheProvider);
    core.info("");

    if (!config.incremental) {
      core.exportVariable("CARGO_INCREMENTAL", 0);
    }

    core.info(`... ${lookupOnly ? "Checking" : "Restoring"} cache ...`);
    const key = config.cacheKey;

    // Pass a copy of cachePaths to avoid mutating the original array as reported by:
    // https://github.com/actions/toolkit/pull/1378
    // TODO: remove this once the underlying bug is fixed.
    const restoreKey = await cacheProvider.cache.restoreCache(config.cachePaths.slice(), key, [config.restoreKey], { lookupOnly });

    if (restoreKey) {
      const match = restoreKey === key;
      core.info(`${lookupOnly ? "Found" : "Restored from"} cache key "${restoreKey}" full match: ${match}.`);

      if (config.incremental) {
        const incrementalKey = await cacheProvider.cache.restoreCache(config.incrementalPaths.slice(), config.incrementalKey, [config.restoreKey], { lookupOnly });
        core.debug(`restoring incremental builds from ${incrementalKey}`);

        if (incrementalKey) {
          for (const workspace of config.workspaces) {
            await restoreIncremental(workspace.target);
          }
        }
      }

      if (!match || config.isIncrementalMissing()) {
        // pre-clean the target directory on cache mismatch
        for (const workspace of config.workspaces) {
          try {
            await cleanTargetDir(workspace.target, [], true, config.incremental);
          } catch { }
        }

        // We restored the cache but it is not a full match.
        config.saveState();
      }

      setCacheHitOutput(match);
    } else {
      core.info("No cache found.");
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

run();
