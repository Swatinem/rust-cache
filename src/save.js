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
const exec = __importStar(require("@actions/exec"));
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
    const save = core.getInput("save-if").toLowerCase() || "true";
    if (!(cacheProvider.cache.isFeatureAvailable() && save === "true")) {
        return;
    }
    try {
        if ((0, config_1.isCacheUpToDate)()) {
            core.info(`Cache up-to-date.`);
            return;
        }
        const config = config_1.CacheConfig.fromState();
        config.printInfo(cacheProvider);
        core.info("");
        // TODO: remove this once https://github.com/actions/toolkit/pull/553 lands
        if (process.env["RUNNER_OS"] == "macOS") {
            await macOsWorkaround();
        }
        const workspaceCrates = core.getInput("cache-workspace-crates").toLowerCase() || "false";
        const allPackages = [];
        for (const workspace of config.workspaces) {
            const packages = await workspace.getPackagesOutsideWorkspaceRoot();
            if (workspaceCrates === "true") {
                const wsMembers = await workspace.getWorkspaceMembers();
                packages.push(...wsMembers);
            }
            allPackages.push(...packages);
            try {
                core.info(`... Cleaning ${workspace.target} ...`);
                await (0, cleanup_1.cleanTargetDir)(workspace.target, packages);
            }
            catch (e) {
                core.debug(`${e.stack}`);
            }
        }
        try {
            const crates = core.getInput("cache-all-crates").toLowerCase() || "false";
            core.info(`... Cleaning cargo registry (cache-all-crates: ${crates}) ...`);
            await (0, cleanup_1.cleanRegistry)(allPackages, crates !== "true");
        }
        catch (e) {
            core.debug(`${e.stack}`);
        }
        if (config.cacheBin) {
            try {
                core.info(`... Cleaning cargo/bin ...`);
                await (0, cleanup_1.cleanBin)(config.cargoBins);
            }
            catch (e) {
                core.debug(`${e.stack}`);
            }
        }
        try {
            core.info(`... Cleaning cargo git cache ...`);
            await (0, cleanup_1.cleanGit)(allPackages);
        }
        catch (e) {
            core.debug(`${e.stack}`);
        }
        core.info(`... Saving cache ...`);
        // Pass a copy of cachePaths to avoid mutating the original array as reported by:
        // https://github.com/actions/toolkit/pull/1378
        // TODO: remove this once the underlying bug is fixed.
        await cacheProvider.cache.saveCache(config.cachePaths.slice(), config.cacheKey);
    }
    catch (e) {
        (0, utils_1.reportError)(e);
    }
    process.exit();
}
run();
async function macOsWorkaround() {
    try {
        // Workaround for https://github.com/actions/cache/issues/403
        // Also see https://github.com/rust-lang/cargo/issues/8603
        await exec.exec("sudo", ["/usr/sbin/purge"], { silent: true });
    }
    catch { }
}
