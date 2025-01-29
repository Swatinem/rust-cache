import * as core from "@actions/core";

import { cleanTargetDir } from "./cleanup";
import { CacheConfig, CARGO_HOME } from "./config";
import { getCacheProvider, reportError } from "./utils";
// import { saveMtimes } from "./incremental";
import path from "path";
import fs from "fs";
import { MtimeData } from "./incremental";

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
    const restoreKey = await cacheProvider.cache.restoreCache(config.cachePaths.slice(), key, [config.restoreKey], {
      lookupOnly,
    });
    if (restoreKey) {
      let match = restoreKey === key;
      core.info(`${lookupOnly ? "Found" : "Restored from"} cache key "${restoreKey}" full match: ${match}.`);

      if (!match) {
        // pre-clean the target directory on cache mismatch
        for (const workspace of config.workspaces) {
          try {
            await cleanTargetDir(workspace.target, [], true);
          } catch { }
        }

        // We restored the cache but it is not a full match.
        config.saveState();
      }

      // Restore the incremental-restore.json file and write the mtimes to all the files in the list
      if (config.incremental) {
        try {
          const restoreJson = path.join(CARGO_HOME, "incremental-restore.json");
          const restoreString = await fs.promises.readFile(restoreJson, "utf8");
          const restoreData: MtimeData = JSON.parse(restoreString);

          if (restoreData.roots.length == 0) {
            throw new Error("No incremental roots found");
          }

          const incrementalKey = await cacheProvider.cache.restoreCache(restoreData.roots, config.incrementalKey, [config.restoreKey], { lookupOnly });
          core.debug(`restoring incremental builds from ${incrementalKey}`);

          for (const [file, mtime] of Object.entries(restoreData.times)) {
            core.debug(`restoring ${file} with mtime ${mtime}`);
            await fs.promises.utimes(file, new Date(mtime), new Date(mtime));
          }

        } catch (err) {
          core.debug(`Could not restore incremental cache - ${err}`);
          core.debug(`${(err as any).stack}`);
          match = false;
        }
      }

      setCacheHitOutput(match);
    } else {
      core.info(`No cache found for ${config.cacheKey} - this key was found ${restoreKey}`);
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
