import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { getCaches, isValidEvent } from "./common";

async function run() {
  if (!isValidEvent()) {
    return;
  }

  try {
    core.exportVariable("CARGO_INCREMENTAL", 0);

    const caches = await getCaches();
    for (const [name, { path, key, restoreKeys }] of Object.entries(caches)) {
      try {
        core.startGroup(`Restoring "${path}" from "${key}"…`);
        const restoreKey = await cache.restoreCache([path], key, restoreKeys);
        if (restoreKey) {
          core.info(`Restored "${path}" from cache key "${restoreKey}".`);
          core.saveState(name, restoreKey);
        } else {
          core.info("No cache found.");
        }
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
