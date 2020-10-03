import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { getCacheConfig, isValidEvent, stateKey } from "./common";

async function run() {
  if (!isValidEvent()) {
    return;
  }

  try {
    core.exportVariable("CARGO_INCREMENTAL", 0);

    const start = Date.now();
    const { paths, key, restoreKeys } = await getCacheConfig();

    core.info(`Restoring paths:\n    ${paths.join("\n    ")}.`);
    core.info(`Using keys:\n    ${[key, ...restoreKeys].join("\n    ")}`);
    try {
      const restoreKey = await cache.restoreCache(paths, key, restoreKeys);
      if (restoreKey) {
        core.info(`Restored from cache key "${restoreKey}".`);
        core.saveState(stateKey, restoreKey);
      } else {
        core.info("No cache found.");
      }
    } catch (e) {
      core.info(`[warning] ${e.message}`);
    }

    const duration = Math.round((Date.now() - start) / 1000);
    if (duration) {
      core.info(`Took ${duration}s.`);
    }
  } catch (e) {
    core.info(`[warning] ${e.message}`);
  }
}

run();
