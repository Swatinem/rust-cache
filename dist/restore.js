import { e as error, g as getCacheProvider, a as getInput, b as exportVariable, C as CacheConfig, i as info, r as reportError, s as setOutput, c as cleanTargetDir } from './cleanup-ctNqmXyy.js';
import 'os';
import 'crypto';
import 'fs';
import 'path';
import 'http';
import 'https';
import 'net';
import 'tls';
import 'events';
import 'assert';
import 'util';
import 'node:assert';
import 'node:net';
import 'node:http';
import 'node:stream';
import 'node:buffer';
import 'node:util';
import 'node:querystring';
import 'node:events';
import 'node:diagnostics_channel';
import 'node:tls';
import 'node:zlib';
import 'node:perf_hooks';
import 'node:util/types';
import 'node:worker_threads';
import 'node:url';
import 'node:async_hooks';
import 'node:console';
import 'node:dns';
import 'string_decoder';
import 'child_process';
import 'timers';
import 'stream';
import 'fs/promises';

process.on("uncaughtException", (e) => {
    error(e.message);
    if (e.stack) {
        error(e.stack);
    }
});
async function run() {
    const cacheProvider = await getCacheProvider();
    if (!cacheProvider.cache.isFeatureAvailable()) {
        setCacheHitOutput(false);
        return;
    }
    try {
        let cacheOnFailure = getInput("cache-on-failure").toLowerCase();
        if (cacheOnFailure !== "true") {
            cacheOnFailure = "false";
        }
        const lookupOnly = getInput("lookup-only").toLowerCase() === "true";
        exportVariable("CACHE_ON_FAILURE", cacheOnFailure);
        exportVariable("CARGO_INCREMENTAL", 0);
        const config = await CacheConfig.new();
        config.printInfo(cacheProvider);
        info("");
        info(`... ${lookupOnly ? "Checking" : "Restoring"} cache ...`);
        const cacheResult = await restoreCache(cacheProvider, config.cachePaths, config.cacheKey, [config.restoreKey], lookupOnly);
        config.cacheNeedsSave = !cacheResult.match;
        if (config.targetCacheEnabled) {
            if (cacheResult.found && !cacheResult.match) {
                // pre-clean the target directory on cargo cache mismatch before restoring target cache
                await cleanTargets(config);
            }
            const targetResult = await restoreCache(cacheProvider, config.targetCachePaths, config.targetCacheKey, config.targetRestoreKeys, lookupOnly, "target");
            config.targetCacheNeedsSave = !targetResult.match;
            if (targetResult.found && !targetResult.match) {
                // pre-clean the target directory on target cache mismatch
                await cleanTargets(config);
            }
            if (!cacheResult.match || !targetResult.match) {
                config.saveState();
            }
            setCacheHitOutput(cacheResult.match && targetResult.match);
        }
        else if (cacheResult.match) {
            setCacheHitOutput(true);
        }
        else {
            if (cacheResult.found) {
                // pre-clean the target directory on cache mismatch
                await cleanTargets(config);
            }
            config.saveState();
            setCacheHitOutput(false);
        }
    }
    catch (e) {
        setCacheHitOutput(false);
        reportError(e);
    }
    process.exit();
}
function setCacheHitOutput(cacheHit) {
    setOutput("cache-hit", cacheHit.toString());
}
async function restoreCache(cacheProvider, paths, key, restoreKeys, lookupOnly, name = "") {
    const label = name ? `${name} cache` : "cache";
    // Pass a copy of cachePaths to avoid mutating the original array as reported by:
    // https://github.com/actions/toolkit/pull/1378
    // TODO: remove this once the underlying bug is fixed.
    const restoreKey = await cacheProvider.cache.restoreCache(paths.slice(), key, restoreKeys, {
        lookupOnly,
    });
    if (!restoreKey) {
        info(`No ${label} found.`);
        return { found: false, match: false };
    }
    const match = restoreKey.localeCompare(key, undefined, {
        sensitivity: "accent",
    }) === 0;
    info(`${lookupOnly ? "Found" : "Restored from"} ${label} key "${restoreKey}" full match: ${match}.`);
    return { found: true, match };
}
async function cleanTargets(config) {
    for (const workspace of config.workspaces) {
        try {
            await cleanTargetDir(workspace.target, [], true);
        }
        catch { }
    }
}
run();
