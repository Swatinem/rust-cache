import * as cache from "@actions/cache";
import * as core from "@actions/core";

import { cleanTargetDir, getCargoBins } from "./cleanup";
import { CacheConfig, STATE_BINS, STATE_KEY } from "./config";
import { withRetries, withTimeout } from "./utils";

process.on("uncaughtException", (e) => {
  core.info(`[warning] ${e.message}`);
  if (e.stack) {
    core.info(e.stack);
  }
});

async function run() {
  if (!cache.isFeatureAvailable()) {
    setCacheHitOutput(false);
    return;
  }

  try {
    var cacheOnFailure = core.getInput("cache-on-failure").toLowerCase();
    if (cacheOnFailure !== "true") {
      cacheOnFailure = "false";
    }
    core.exportVariable("CACHE_ON_FAILURE", cacheOnFailure);
    core.exportVariable("CARGO_INCREMENTAL", 0);

    const config = await CacheConfig.new();
    config.printInfo();
    core.info("");

    const bins = await getCargoBins();
    core.saveState(STATE_BINS, JSON.stringify([...bins]));

    core.info(`... Restoring cache ...`);
    const key = config.cacheKey;
    const restoreKey = await withRetries(
      () =>
        withTimeout(
          () => cache.restoreCache(config.cachePaths, key, [config.restoreKey]),
          config.timeout
        ),
      config.maxRetryAttempts,
      () => true
    );

    if (restoreKey) {
      core.info(`Restored from cache key "${restoreKey}".`);
      core.saveState(STATE_KEY, restoreKey);

      if (restoreKey !== key) {
        // pre-clean the target directory on cache mismatch
        for (const workspace of config.workspaces) {
          try {
            const packages = await workspace.getPackages();

            await cleanTargetDir(workspace.target, packages, true);
          } catch {}
        }
      }

      setCacheHitOutput(restoreKey === key);
    } else {
      core.info("No cache found.");

      setCacheHitOutput(false);
    }
  } catch (e) {
    setCacheHitOutput(false);

    core.info(`[warning] ${(e as any).stack}`);
  }
}

function setCacheHitOutput(cacheHit: boolean): void {
  core.setOutput("cache-hit", cacheHit.toString());
}

run();
