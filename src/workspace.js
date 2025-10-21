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
exports.Workspace = void 0;
const core = __importStar(require("@actions/core"));
const path_1 = __importDefault(require("path"));
const utils_1 = require("./utils");
const SAVE_TARGETS = new Set(["lib", "proc-macro"]);
class Workspace {
    constructor(root, target) {
        this.root = root;
        this.target = target;
    }
    async getPackages(filter, ...extraArgs) {
        let packages = [];
        try {
            core.debug(`collecting metadata for "${this.root}"`);
            const meta = JSON.parse(await (0, utils_1.getCmdOutput)("cargo", ["metadata", "--all-features", "--format-version", "1", ...extraArgs], {
                cwd: this.root,
                env: { "CARGO_ENCODED_RUSTFLAGS": "" },
            }));
            core.debug(`workspace "${this.root}" has ${meta.packages.length} packages`);
            for (const pkg of meta.packages.filter(filter)) {
                const targets = pkg.targets.filter((t) => t.kind.some((kind) => SAVE_TARGETS.has(kind))).map((t) => t.name);
                packages.push({ name: pkg.name, version: pkg.version, targets, path: path_1.default.dirname(pkg.manifest_path) });
            }
        }
        catch (err) {
            console.error(err);
        }
        return packages;
    }
    async getPackagesOutsideWorkspaceRoot() {
        return await this.getPackages((pkg) => !pkg.manifest_path.startsWith(this.root));
    }
    async getWorkspaceMembers() {
        return await this.getPackages((_) => true, "--no-deps");
    }
}
exports.Workspace = Workspace;
