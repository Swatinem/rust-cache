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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanTargetDir = cleanTargetDir;
exports.getCargoBins = getCargoBins;
exports.cleanBin = cleanBin;
exports.cleanRegistry = cleanRegistry;
exports.cleanGit = cleanGit;
const core = __importStar(require("@actions/core"));
const io = __importStar(require("@actions/io"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
const utils_1 = require("./utils");
async function cleanTargetDir(targetDir, packages, checkTimestamp = false) {
    core.debug(`cleaning target directory "${targetDir}"`);
    // remove all *files* from the profile directory
    let dir = await fs_1.default.promises.opendir(targetDir);
    for await (const dirent of dir) {
        if (dirent.isDirectory()) {
            let dirName = path_1.default.join(dir.path, dirent.name);
            // is it a profile dir, or a nested target dir?
            let isNestedTarget = (await (0, utils_1.exists)(path_1.default.join(dirName, "CACHEDIR.TAG"))) || (await (0, utils_1.exists)(path_1.default.join(dirName, ".rustc_info.json")));
            try {
                if (isNestedTarget) {
                    await cleanTargetDir(dirName, packages, checkTimestamp);
                }
                else {
                    await cleanProfileTarget(dirName, packages, checkTimestamp);
                }
            }
            catch { }
        }
        else if (dirent.name !== "CACHEDIR.TAG") {
            await rm(dir.path, dirent);
        }
    }
}
async function cleanProfileTarget(profileDir, packages, checkTimestamp = false) {
    core.debug(`cleaning profile directory "${profileDir}"`);
    // Quite a few testing utility crates store compilation artifacts as nested
    // workspaces under `target/tests`. Notably, `target/tests/target` and
    // `target/tests/trybuild`.
    if (path_1.default.basename(profileDir) === "tests") {
        try {
            // https://github.com/vertexclique/kaos/blob/9876f6c890339741cc5be4b7cb9df72baa5a6d79/src/cargo.rs#L25
            // https://github.com/eupn/macrotest/blob/c4151a5f9f545942f4971980b5d264ebcd0b1d11/src/cargo.rs#L27
            cleanTargetDir(path_1.default.join(profileDir, "target"), packages, checkTimestamp);
        }
        catch { }
        try {
            // https://github.com/dtolnay/trybuild/blob/eec8ca6cb9b8f53d0caf1aa499d99df52cae8b40/src/cargo.rs#L50
            cleanTargetDir(path_1.default.join(profileDir, "trybuild"), packages, checkTimestamp);
        }
        catch { }
        // Delete everything else.
        await rmExcept(profileDir, new Set(["target", "trybuild"]), checkTimestamp);
        return;
    }
    let keepProfile = new Set(["build", ".fingerprint", "deps"]);
    await rmExcept(profileDir, keepProfile);
    const keepPkg = new Set(packages.map((p) => p.name));
    await rmExcept(path_1.default.join(profileDir, "build"), keepPkg, checkTimestamp);
    await rmExcept(path_1.default.join(profileDir, ".fingerprint"), keepPkg, checkTimestamp);
    const keepDeps = new Set(packages.flatMap((p) => {
        const names = [];
        for (const n of [p.name, ...p.targets]) {
            const name = n.replace(/-/g, "_");
            names.push(name, `lib${name}`);
        }
        return names;
    }));
    await rmExcept(path_1.default.join(profileDir, "deps"), keepDeps, checkTimestamp);
}
async function getCargoBins() {
    const bins = new Set();
    try {
        const { installs } = JSON.parse(await fs_1.default.promises.readFile(path_1.default.join(config_1.CARGO_HOME, ".crates2.json"), "utf8"));
        for (const pkg of Object.values(installs)) {
            for (const bin of pkg.bins) {
                bins.add(bin);
            }
        }
    }
    catch { }
    return bins;
}
/**
 * Clean the cargo bin directory, removing the binaries that existed
 * when the action started, as they were not created by the build.
 *
 * @param oldBins The binaries that existed when the action started.
 */
async function cleanBin(oldBins) {
    const bins = await getCargoBins();
    for (const bin of oldBins) {
        bins.delete(bin);
    }
    const dir = await fs_1.default.promises.opendir(path_1.default.join(config_1.CARGO_HOME, "bin"));
    for await (const dirent of dir) {
        if (dirent.isFile() && !bins.has(dirent.name)) {
            await rm(dir.path, dirent);
        }
    }
}
async function cleanRegistry(packages, crates = true) {
    // remove `.cargo/credentials.toml`
    try {
        const credentials = path_1.default.join(config_1.CARGO_HOME, ".cargo", "credentials.toml");
        core.debug(`deleting "${credentials}"`);
        await fs_1.default.promises.unlink(credentials);
    }
    catch { }
    // `.cargo/registry/index`
    let pkgSet = new Set(packages.map((p) => p.name));
    const indexDir = await fs_1.default.promises.opendir(path_1.default.join(config_1.CARGO_HOME, "registry", "index"));
    for await (const dirent of indexDir) {
        if (dirent.isDirectory()) {
            // eg `.cargo/registry/index/github.com-1ecc6299db9ec823`
            // or `.cargo/registry/index/index.crates.io-e139d0d48fed7772`
            const dirPath = path_1.default.join(indexDir.path, dirent.name);
            // for a git registry, we can remove `.cache`, as cargo will recreate it from git
            if (await (0, utils_1.exists)(path_1.default.join(dirPath, ".git"))) {
                await rmRF(path_1.default.join(dirPath, ".cache"));
            }
            else {
                await cleanRegistryIndexCache(dirPath, pkgSet);
            }
        }
    }
    if (!crates) {
        core.debug("skipping registry cache and src cleanup");
        return;
    }
    // `.cargo/registry/src`
    // Cargo usually re-creates these from the `.crate` cache below,
    // but for some reason that does not work for `-sys` crates that check timestamps
    // to decide if rebuilds are necessary.
    pkgSet = new Set(packages.filter((p) => p.name.endsWith("-sys")).map((p) => `${p.name}-${p.version}`));
    const srcDir = await fs_1.default.promises.opendir(path_1.default.join(config_1.CARGO_HOME, "registry", "src"));
    for await (const dirent of srcDir) {
        if (dirent.isDirectory()) {
            // eg `.cargo/registry/src/github.com-1ecc6299db9ec823`
            // or `.cargo/registry/src/index.crates.io-e139d0d48fed7772`
            const dir = await fs_1.default.promises.opendir(path_1.default.join(srcDir.path, dirent.name));
            for await (const dirent of dir) {
                if (dirent.isDirectory() && !pkgSet.has(dirent.name)) {
                    await rmRF(path_1.default.join(dir.path, dirent.name));
                }
            }
        }
    }
    // `.cargo/registry/cache`
    pkgSet = new Set(packages.map((p) => `${p.name}-${p.version}.crate`));
    const cacheDir = await fs_1.default.promises.opendir(path_1.default.join(config_1.CARGO_HOME, "registry", "cache"));
    for await (const dirent of cacheDir) {
        if (dirent.isDirectory()) {
            // eg `.cargo/registry/cache/github.com-1ecc6299db9ec823`
            // or `.cargo/registry/cache/index.crates.io-e139d0d48fed7772`
            const dir = await fs_1.default.promises.opendir(path_1.default.join(cacheDir.path, dirent.name));
            for await (const dirent of dir) {
                // here we check that the downloaded `.crate` matches one from our dependencies
                if (dirent.isFile() && !pkgSet.has(dirent.name)) {
                    await rm(dir.path, dirent);
                }
            }
        }
    }
}
/// Recursively walks and cleans the index `.cache`
async function cleanRegistryIndexCache(dirName, keepPkg) {
    let dirIsEmpty = true;
    const cacheDir = await fs_1.default.promises.opendir(dirName);
    for await (const dirent of cacheDir) {
        if (dirent.isDirectory()) {
            if (await cleanRegistryIndexCache(path_1.default.join(dirName, dirent.name), keepPkg)) {
                await rm(dirName, dirent);
            }
            else {
                dirIsEmpty && (dirIsEmpty = false);
            }
        }
        else {
            if (keepPkg.has(dirent.name)) {
                dirIsEmpty && (dirIsEmpty = false);
            }
            else {
                await rm(dirName, dirent);
            }
        }
    }
    return dirIsEmpty;
}
async function cleanGit(packages) {
    const coPath = path_1.default.join(config_1.CARGO_HOME, "git", "checkouts");
    const dbPath = path_1.default.join(config_1.CARGO_HOME, "git", "db");
    const repos = new Map();
    for (const p of packages) {
        if (!p.path.startsWith(coPath)) {
            continue;
        }
        const [repo, ref] = p.path.slice(coPath.length + 1).split(path_1.default.sep);
        const refs = repos.get(repo);
        if (refs) {
            refs.add(ref);
        }
        else {
            repos.set(repo, new Set([ref]));
        }
    }
    // we have to keep both the clone, and the checkout, removing either will
    // trigger a rebuild
    // clean the db
    try {
        let dir = await fs_1.default.promises.opendir(dbPath);
        for await (const dirent of dir) {
            if (!repos.has(dirent.name)) {
                await rm(dir.path, dirent);
            }
        }
    }
    catch { }
    // clean the checkouts
    try {
        let dir = await fs_1.default.promises.opendir(coPath);
        for await (const dirent of dir) {
            const refs = repos.get(dirent.name);
            if (!refs) {
                await rm(dir.path, dirent);
                continue;
            }
            if (!dirent.isDirectory()) {
                continue;
            }
            const refsDir = await fs_1.default.promises.opendir(path_1.default.join(dir.path, dirent.name));
            for await (const dirent of refsDir) {
                if (!refs.has(dirent.name)) {
                    await rm(refsDir.path, dirent);
                }
            }
        }
    }
    catch { }
}
const ONE_WEEK = 7 * 24 * 3600 * 1000;
/**
 * Removes all files or directories in `dirName` matching some criteria.
 *
 * When the `checkTimestamp` flag is set, this will also remove anything older
 * than one week.
 *
 * Otherwise, it will remove everything that does not match any string in the
 * `keepPrefix` set.
 * The matching strips and trailing `-$hash` suffix.
 */
async function rmExcept(dirName, keepPrefix, checkTimestamp = false) {
    const dir = await fs_1.default.promises.opendir(dirName);
    for await (const dirent of dir) {
        if (checkTimestamp) {
            const fileName = path_1.default.join(dir.path, dirent.name);
            const { mtime } = await fs_1.default.promises.stat(fileName);
            const isOutdated = Date.now() - mtime.getTime() > ONE_WEEK;
            if (isOutdated) {
                await rm(dir.path, dirent);
            }
            return;
        }
        let name = dirent.name;
        // strip the trailing hash
        const idx = name.lastIndexOf("-");
        if (idx !== -1) {
            name = name.slice(0, idx);
        }
        if (!keepPrefix.has(name)) {
            await rm(dir.path, dirent);
        }
    }
}
async function rm(parent, dirent) {
    try {
        const fileName = path_1.default.join(parent, dirent.name);
        core.debug(`deleting "${fileName}"`);
        if (dirent.isFile()) {
            await fs_1.default.promises.unlink(fileName);
        }
        else if (dirent.isDirectory()) {
            await io.rmRF(fileName);
        }
    }
    catch { }
}
async function rmRF(dirName) {
    core.debug(`deleting "${dirName}"`);
    await io.rmRF(dirName);
}
