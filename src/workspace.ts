import * as core from "@actions/core";
import path from "path";

import { getCmdOutput } from "./utils.js";

const SAVE_TARGETS = new Set(["lib", "cdylib", "dylib", "rlib", "staticlib", "proc-macro"]);

export class Workspace {
  constructor(
    public root: string,
    public target: string,
  ) {}

  async getPackages(
    cmdFormat: string,
    filter: (p: Meta["packages"][0]) => boolean,
    extraArgs?: string,
  ): Promise<{ packages: Packages; workspaceRoot: string }> {
    const cmd = "cargo metadata --all-features --format-version 1" + (extraArgs ? ` ${extraArgs}` : "");
    let packages: Packages = [];
    let workspaceRoot = this.root;
    try {
      core.debug(`collecting metadata for "${this.root}"`);
      const meta: Meta = JSON.parse(
        await getCmdOutput(cmdFormat, cmd, {
          cwd: this.root,
          env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: "" },
        }),
      );
      core.debug(`workspace "${this.root}" has ${meta.packages.length} packages`);
      workspaceRoot = meta.workspace_root;
      for (const pkg of meta.packages.filter(filter)) {
        const targets = pkg.targets.filter((t) => t.kind.some((kind) => SAVE_TARGETS.has(kind))).map((t) => t.name);
        packages.push({ name: pkg.name, version: pkg.version, targets, path: path.dirname(pkg.manifest_path) });
      }
    } catch (err) {
      console.error(err);
    }
    return { packages, workspaceRoot };
  }

  public async getPackagesOutsideWorkspaceRoot(cmdFormat: string): Promise<Packages> {
    const filter = (pkg: Meta["packages"][0]) => !pkg.manifest_path.startsWith(this.root);
    return (await this.getPackages(cmdFormat, filter)).packages;
  }

  /** The workspace's members, and the root directory of the cargo workspace they belong to. */
  public async getWorkspaceMembers(cmdFormat: string): Promise<{ members: Packages; workspaceRoot: string }> {
    const { packages, workspaceRoot } = await this.getPackages(cmdFormat, (_) => true, "--no-deps");
    return { members: packages, workspaceRoot };
  }
}

export interface PackageDefinition {
  name: string;
  version: string;
  path: string;
  targets: Array<string>;
}

export type Packages = Array<PackageDefinition>;

interface Meta {
  workspace_root: string;
  packages: Array<{
    name: string;
    version: string;
    manifest_path: string;
    targets: Array<{ kind: Array<string>; name: string }>;
  }>;
}
