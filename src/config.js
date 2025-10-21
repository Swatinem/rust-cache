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
exports.CacheConfig = exports.CARGO_HOME = void 0;
exports.isCacheUpToDate = isCacheUpToDate;
const core = __importStar(require("@actions/core"));
const glob = __importStar(require("@actions/glob"));
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const promises_1 = __importDefault(require("fs/promises"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const toml = __importStar(require("smol-toml"));
const cleanup_1 = require("./cleanup");
const utils_1 = require("./utils");
const workspace_1 = require("./workspace");
const HOME = os_1.default.homedir();
exports.CARGO_HOME = process.env.CARGO_HOME || path_1.default.join(HOME, ".cargo");
const STATE_CONFIG = "RUST_CACHE_CONFIG";
const HASH_LENGTH = 8;
class CacheConfig {
    constructor() {
        /** All the paths we want to cache */
        this.cachePaths = [];
        /** The primary cache key */
        this.cacheKey = "";
        /** The secondary (restore) key that only contains the prefix and environment */
        this.restoreKey = "";
        /** Whether to cache CARGO_HOME/.bin */
        this.cacheBin = true;
        /** The workspace configurations */
        this.workspaces = [];
        /** The cargo binaries present during main step */
        this.cargoBins = [];
        /** The prefix portion of the cache key */
        this.keyPrefix = "";
        /** The rust version considered for the cache key */
        this.keyRust = "";
        /** The environment variables considered for the cache key */
        this.keyEnvs = [];
        /** The files considered for the cache key */
        this.keyFiles = [];
    }
    /**
     * Constructs a [`CacheConfig`] with all the paths and keys.
     *
     * This will read the action `input`s, and read and persist `state` as necessary.
     */
    static async new() {
        const self = new CacheConfig();
        // Construct key prefix:
        // This uses either the `shared-key` input,
        // or the `key` input combined with the `job` key.
        let key = core.getInput("prefix-key") || "v0-rust";
        const sharedKey = core.getInput("shared-key");
        if (sharedKey) {
            key += `-${sharedKey}`;
        }
        else {
            const inputKey = core.getInput("key");
            if (inputKey) {
                key += `-${inputKey}`;
            }
            const job = process.env.GITHUB_JOB;
            if ((job) && core.getInput("use-job-key").toLowerCase() == "true") {
                key += `-${job}`;
            }
        }
        // Add runner OS and CPU architecture to the key to avoid cross-contamination of cache
        const runnerOS = os_1.default.type();
        const runnerArch = os_1.default.arch();
        key += `-${runnerOS}-${runnerArch}`;
        self.keyPrefix = key;
        // Construct environment portion of the key:
        // This consists of a hash that considers the rust version
        // as well as all the environment variables as given by a default list
        // and the `env-vars` input.
        // The env vars are sorted, matched by prefix and hashed into the
        // resulting environment hash.
        let hasher = crypto_1.default.createHash("sha1");
        const rustVersion = await getRustVersion();
        let keyRust = `${rustVersion.release} ${rustVersion.host}`;
        hasher.update(keyRust);
        hasher.update(rustVersion["commit-hash"]);
        keyRust += ` (${rustVersion["commit-hash"]})`;
        self.keyRust = keyRust;
        // these prefixes should cover most of the compiler / rust / cargo keys
        const envPrefixes = ["CARGO", "CC", "CFLAGS", "CXX", "CMAKE", "RUST"];
        envPrefixes.push(...core.getInput("env-vars").split(/\s+/).filter(Boolean));
        // sort the available env vars so we have a more stable hash
        const keyEnvs = [];
        const envKeys = Object.keys(process.env);
        envKeys.sort((a, b) => a.localeCompare(b));
        for (const key of envKeys) {
            const value = process.env[key];
            if (envPrefixes.some((prefix) => key.startsWith(prefix)) && value) {
                hasher.update(`${key}=${value}`);
                keyEnvs.push(key);
            }
        }
        self.keyEnvs = keyEnvs;
        // Add job hash suffix if 'add-job-hash' is true
        if (core.getInput("add-job-hash").toLowerCase() == "true") {
            key += `-${digest(hasher)}`;
        }
        self.restoreKey = key;
        // Construct the lockfiles portion of the key:
        // This considers all the files found via globbing for various manifests
        // and lockfiles.
        self.cacheBin = core.getInput("cache-bin").toLowerCase() == "true";
        // Constructs the workspace config and paths to restore:
        // The workspaces are given using a `$workspace -> $target` syntax.
        const workspaces = [];
        const workspacesInput = core.getInput("workspaces") || ".";
        for (const workspace of workspacesInput.trim().split("\n")) {
            let [root, target = "target"] = workspace.split("->").map((s) => s.trim());
            root = path_1.default.resolve(root);
            target = path_1.default.join(root, target);
            workspaces.push(new workspace_1.Workspace(root, target));
        }
        self.workspaces = workspaces;
        let keyFiles = await globFiles(".cargo/config.toml\nrust-toolchain\nrust-toolchain.toml");
        const parsedKeyFiles = []; // keyFiles that are parsed, pre-processed and hashed
        hasher = crypto_1.default.createHash("sha1");
        for (const workspace of workspaces) {
            const root = workspace.root;
            keyFiles.push(...(await globFiles(`${root}/**/.cargo/config.toml\n${root}/**/rust-toolchain\n${root}/**/rust-toolchain.toml`)));
            const workspaceMembers = await workspace.getWorkspaceMembers();
            const cargo_manifests = sort_and_uniq(workspaceMembers.map((member) => path_1.default.join(member.path, "Cargo.toml")));
            for (const cargo_manifest of cargo_manifests) {
                try {
                    const content = await promises_1.default.readFile(cargo_manifest, { encoding: "utf8" });
                    // Use any since TomlPrimitive is not exposed
                    const parsed = toml.parse(content);
                    if ("package" in parsed) {
                        const pack = parsed.package;
                        if ("version" in pack) {
                            pack["version"] = "0.0.0";
                        }
                    }
                    for (const prefix of ["", "build-", "dev-"]) {
                        const section_name = `${prefix}dependencies`;
                        if (!(section_name in parsed)) {
                            continue;
                        }
                        const deps = parsed[section_name];
                        for (const key of Object.keys(deps)) {
                            const dep = deps[key];
                            try {
                                if ("path" in dep) {
                                    dep.version = "0.0.0";
                                    dep.path = "";
                                }
                            }
                            catch (_e) {
                                // Not an object, probably a string (version),
                                // continue.
                                continue;
                            }
                        }
                    }
                    hasher.update(JSON.stringify(parsed));
                    parsedKeyFiles.push(cargo_manifest);
                }
                catch (e) {
                    // Fallback to caching them as regular file
                    core.warning(`Error parsing Cargo.toml manifest, fallback to caching entire file: ${e}`);
                    keyFiles.push(cargo_manifest);
                }
            }
            const cargo_lock = path_1.default.join(workspace.root, "Cargo.lock");
            if (await (0, utils_1.exists)(cargo_lock)) {
                try {
                    const content = await promises_1.default.readFile(cargo_lock, { encoding: "utf8" });
                    const parsed = toml.parse(content);
                    if ((parsed.version !== 3 && parsed.version !== 4) || !("package" in parsed)) {
                        // Fallback to caching them as regular file since this action
                        // can only handle Cargo.lock format version 3
                        core.warning("Unsupported Cargo.lock format, fallback to caching entire file");
                        keyFiles.push(cargo_lock);
                        continue;
                    }
                    // Package without `[[package]].source` and `[[package]].checksum`
                    // are the one with `path = "..."` to crates within the workspace.
                    const packages = parsed.package.filter((p) => "source" in p || "checksum" in p);
                    hasher.update(JSON.stringify(packages));
                    parsedKeyFiles.push(cargo_lock);
                }
                catch (e) {
                    // Fallback to caching them as regular file
                    core.warning(`Error parsing Cargo.lock manifest, fallback to caching entire file: ${e}`);
                    keyFiles.push(cargo_lock);
                }
            }
        }
        keyFiles = sort_and_uniq(keyFiles);
        for (const file of keyFiles) {
            for await (const chunk of fs_1.default.createReadStream(file)) {
                hasher.update(chunk);
            }
        }
        let lockHash = digest(hasher);
        keyFiles.push(...parsedKeyFiles);
        self.keyFiles = sort_and_uniq(keyFiles);
        key += `-${lockHash}`;
        self.cacheKey = key;
        self.cachePaths = [path_1.default.join(exports.CARGO_HOME, "registry"), path_1.default.join(exports.CARGO_HOME, "git")];
        if (self.cacheBin) {
            self.cachePaths = [
                path_1.default.join(exports.CARGO_HOME, "bin"),
                path_1.default.join(exports.CARGO_HOME, ".crates.toml"),
                path_1.default.join(exports.CARGO_HOME, ".crates2.json"),
                ...self.cachePaths,
            ];
        }
        const cacheTargets = core.getInput("cache-targets").toLowerCase() || "true";
        if (cacheTargets === "true") {
            self.cachePaths.push(...workspaces.map((ws) => ws.target));
        }
        const cacheDirectories = core.getInput("cache-directories");
        for (const dir of cacheDirectories.trim().split(/\s+/).filter(Boolean)) {
            self.cachePaths.push(dir);
        }
        const bins = await (0, cleanup_1.getCargoBins)();
        self.cargoBins = Array.from(bins.values());
        return self;
    }
    /**
     * Reads and returns the cache config from the action `state`.
     *
     * @throws {Error} if the state is not present.
     * @returns {CacheConfig} the configuration.
     * @see {@link CacheConfig#saveState}
     * @see {@link CacheConfig#new}
     */
    static fromState() {
        const source = core.getState(STATE_CONFIG);
        if (!source) {
            throw new Error("Cache configuration not found in state");
        }
        const self = new CacheConfig();
        Object.assign(self, JSON.parse(source));
        self.workspaces = self.workspaces.map((w) => new workspace_1.Workspace(w.root, w.target));
        return self;
    }
    /**
     * Prints the configuration to the action log.
     */
    printInfo(cacheProvider) {
        core.startGroup("Cache Configuration");
        core.info(`Cache Provider:`);
        core.info(`    ${cacheProvider.name}`);
        core.info(`Workspaces:`);
        for (const workspace of this.workspaces) {
            core.info(`    ${workspace.root}`);
        }
        core.info(`Cache Paths:`);
        for (const path of this.cachePaths) {
            core.info(`    ${path}`);
        }
        core.info(`Restore Key:`);
        core.info(`    ${this.restoreKey}`);
        core.info(`Cache Key:`);
        core.info(`    ${this.cacheKey}`);
        core.info(`.. Prefix:`);
        core.info(`  - ${this.keyPrefix}`);
        core.info(`.. Environment considered:`);
        core.info(`  - Rust Version: ${this.keyRust}`);
        for (const env of this.keyEnvs) {
            core.info(`  - ${env}`);
        }
        core.info(`.. Lockfiles considered:`);
        for (const file of this.keyFiles) {
            core.info(`  - ${file}`);
        }
        core.endGroup();
    }
    /**
     * Saves the configuration to the state store.
     * This is used to restore the configuration in the post action.
     */
    saveState() {
        core.saveState(STATE_CONFIG, this);
    }
}
exports.CacheConfig = CacheConfig;
/**
 * Checks if the cache is up to date.
 *
 * @returns `true` if the cache is up to date, `false` otherwise.
 */
function isCacheUpToDate() {
    return core.getState(STATE_CONFIG) === "";
}
/**
 * Returns a hex digest of the given hasher truncated to `HASH_LENGTH`.
 *
 * @param hasher The hasher to digest.
 * @returns The hex digest.
 */
function digest(hasher) {
    return hasher.digest("hex").substring(0, HASH_LENGTH);
}
async function getRustVersion() {
    const stdout = await (0, utils_1.getCmdOutput)("rustc", ["-vV"]);
    let splits = stdout
        .split(/[\n\r]+/)
        .filter(Boolean)
        .map((s) => s.split(":").map((s) => s.trim()))
        .filter((s) => s.length === 2);
    return Object.fromEntries(splits);
}
async function globFiles(pattern) {
    const globber = await glob.create(pattern, {
        followSymbolicLinks: false,
    });
    // fs.statSync resolve the symbolic link and returns stat for the
    // file it pointed to, so isFile would make sure the resolved
    // file is actually a regular file.
    return (await globber.glob()).filter((file) => fs_1.default.statSync(file).isFile());
}
function sort_and_uniq(a) {
    return a
        .sort((a, b) => a.localeCompare(b))
        .reduce((accumulator, currentValue) => {
        const len = accumulator.length;
        // If accumulator is empty or its last element != currentValue
        // Since array is already sorted, elements with the same value
        // are grouped together to be continugous in space.
        //
        // If currentValue != last element, then it must be unique.
        if (len == 0 || accumulator[len - 1].localeCompare(currentValue) != 0) {
            accumulator.push(currentValue);
        }
        return accumulator;
    }, []);
}
