import path from "path";

import { getCmdOutput } from "./utils";

export class Workspace {
  constructor(public root: string, public target: string) {}

  public async getPackages(): Promise<Packages> {
    let packages: Packages = [];
    try {
      const meta: Meta = JSON.parse(
        await getCmdOutput("cargo", ["metadata", "--all-features", "--format-version", "1"], {
          cwd: this.root,
        }),
      );
      for (const pkg of meta.packages) {
        if (pkg.manifest_path.startsWith(this.root)) {
          continue;
        }
        const targets = pkg.targets.filter((t) => t.kind[0] === "lib").map((t) => t.name);
        packages.push({ name: pkg.name, version: pkg.version, targets, path: path.dirname(pkg.manifest_path) });
      }
    } catch {}
    return packages;
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
  packages: Array<{
    name: string;
    version: string;
    manifest_path: string;
    targets: Array<{ kind: Array<string>; name: string }>;
  }>;
}
