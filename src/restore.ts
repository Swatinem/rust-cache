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
    for (const [type, { name, path, key, restoreKeys }] of Object.entries(caches)) {
      try {
        core.startGroup(`Restoring ${name}"…`);
        core.info(`Restoring to path "${path}".`);
        core.info(`Using keys:\n    ${[key, ...restoreKeys].join("\n    ")}`);
        const restoreKey = await cache.restoreCache([path], key, restoreKeys);
        if (restoreKey) {
          core.info(`Restored from cache key "${restoreKey}".`);
          core.saveState(type, restoreKey);
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
