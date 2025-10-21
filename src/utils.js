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
exports.reportError = reportError;
exports.getCmdOutput = getCmdOutput;
exports.getCacheProvider = getCacheProvider;
exports.exists = exists;
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const buildjetCache = __importStar(require("@actions/buildjet-cache"));
const warpbuildCache = __importStar(require("@actions/warpbuild-cache"));
const ghCache = __importStar(require("@actions/cache"));
const fs_1 = __importDefault(require("fs"));
function reportError(e) {
    const { commandFailed } = e;
    if (commandFailed) {
        core.error(`Command failed: ${commandFailed.command}`);
        core.error(commandFailed.stderr);
    }
    else {
        core.error(`${e.stack}`);
    }
}
async function getCmdOutput(cmd, args = [], options = {}) {
    let stdout = "";
    let stderr = "";
    try {
        await exec.exec(cmd, args, {
            silent: true,
            listeners: {
                stdout(data) {
                    stdout += data.toString();
                },
                stderr(data) {
                    stderr += data.toString();
                },
            },
            ...options,
        });
    }
    catch (e) {
        e.commandFailed = {
            command: `${cmd} ${args.join(" ")}`,
            stderr,
        };
        throw e;
    }
    return stdout;
}
function getCacheProvider() {
    const cacheProvider = core.getInput("cache-provider");
    let cache;
    switch (cacheProvider) {
        case "github":
            cache = ghCache;
            break;
        case "buildjet":
            cache = buildjetCache;
            break;
        case "warpbuild":
            cache = warpbuildCache;
            break;
        default:
            throw new Error(`The \`cache-provider\` \`${cacheProvider}\` is not valid.`);
    }
    return {
        name: cacheProvider,
        cache: cache,
    };
}
async function exists(path) {
    try {
        await fs_1.default.promises.access(path);
        return true;
    }
    catch {
        return false;
    }
}
