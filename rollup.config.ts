import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import path from "path";
import type { Plugin, RollupWatchOptions } from "rollup";

// @actions/cache does not export the archive helpers that the S3 provider
// reuses; resolve the two internal modules directly so they get bundled.
const cacheInternals: Plugin = {
  name: "bundle-actions-cache-internals",
  resolveId(source) {
    if (source === "@actions/cache/lib/internal/cacheUtils") {
      return path.resolve("node_modules/@actions/cache/lib/internal/cacheUtils.js");
    }
    if (source === "@actions/cache/lib/internal/tar") {
      return path.resolve("node_modules/@actions/cache/lib/internal/tar.js");
    }
    return null;
  },
};

const config: RollupWatchOptions = {
  input: ["./.build/src/restore.js", "./.build/src/save.js"],
  output: { dir: "./dist", format: "es" },
  plugins: [cacheInternals, nodeResolve({ preferBuiltins: true }), commonjs(), json()],
};
export default config;
