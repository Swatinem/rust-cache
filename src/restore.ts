import * as cache from "@actions/cache";
import * as core from "@actions/core";
import path from "path";
import { cleanTarget, getCacheConfig, getCargoBins, getPackages, stateBins, stateKey } from "./common";

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

    const { paths, key, restoreKeys, workspaces } = await getCacheConfig();
    const restorePaths = paths.concat(workspaces);

    const bins = await getCargoBins();
    core.saveState(stateBins, JSON.stringify([...bins]));

    core.info(`Restoring paths:\n    ${restorePaths.join("\n    ")}`);
    core.info(`In directory:\n    ${process.cwd()}`);
    core.info(`Using keys:\n    ${[key, ...restoreKeys].join("\n    ")}`);
    const restoreKey = await cache.restoreCache(restorePaths, key, restoreKeys);
    if (restoreKey) {
      core.info(`Restored from cache key "${restoreKey}".`);
      core.saveState(stateKey, restoreKey);

      if (restoreKey !== key) {
        // pre-clean the target directory on cache mismatch
        const packages = await getPackages();

        for (const workspace of workspaces) {
          const target = path.join(workspace, "target");
          await cleanTarget(target, packages);
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
