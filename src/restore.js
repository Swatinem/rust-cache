"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const cleanup_1 = require("./cleanup");
const config_1 = require("./config");
const utils_1 = require("./utils");
process.on("uncaughtException", (e) => {
    core.error(e.message);
    if (e.stack) {
        core.error(e.stack);
    }
});
async function run() {
    const cacheProvider = (0, utils_1.getCacheProvider)();
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
        core.exportVariable("CARGO_INCREMENTAL", 0);
        const config = await config_1.CacheConfig.new();
        config.printInfo(cacheProvider);
        core.info("");
        core.info(`... ${lookupOnly ? "Checking" : "Restoring"} cache ...`);
        const key = config.cacheKey;
        // Pass a copy of cachePaths to avoid mutating the original array as reported by:
        // https://github.com/actions/toolkit/pull/1378
        // TODO: remove this once the underlying bug is fixed.
        const restoreKey = await cacheProvider.cache.restoreCache(config.cachePaths.slice(), key, [config.restoreKey], {
            lookupOnly,
        });
        if (restoreKey) {
            const match = restoreKey === key;
            core.info(`${lookupOnly ? "Found" : "Restored from"} cache key "${restoreKey}" full match: ${match}.`);
            if (!match) {
                // pre-clean the target directory on cache mismatch
                for (const workspace of config.workspaces) {
                    try {
                        await (0, cleanup_1.cleanTargetDir)(workspace.target, [], true);
                    }
                    catch { }
                }
                // We restored the cache but it is not a full match.
                config.saveState();
            }
            setCacheHitOutput(match);
        }
        else {
            core.info("No cache found.");
            config.saveState();
            setCacheHitOutput(false);
        }
    }
    catch (e) {
        setCacheHitOutput(false);
        (0, utils_1.reportError)(e);
    }
    process.exit();
}
function setCacheHitOutput(cacheHit) {
    core.setOutput("cache-hit", cacheHit.toString());
}
run();
