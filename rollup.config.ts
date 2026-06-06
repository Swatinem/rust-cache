// import * as fs from "node:fs";

import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import type { RollupWatchOptions } from "rollup";

// const pkg = JSON.parse(fs.readFileSync("./package.json", { encoding: "utf-8" }));
// const external = ["node:module", "node:path", "node:fs", "node:fs/promises", "typescript", "rollup", "@babel/code-frame", "magic-string", "@jridgewell/remapping", "@jridgewell/sourcemap-codec", "convert-source-map"];

const config: Array<RollupWatchOptions> = [
  {
    input: "./.build/src/restore.js",
    output: { file: "./dist/restore.js", format: "es" },
    plugins: [nodeResolve({ preferBuiltins: true }), commonjs(), json()],
  },
  {
    input: "./.build/src/save.js",
    output: { file: "./dist/save.js", format: "es" },
    plugins: [nodeResolve({ preferBuiltins: true }), commonjs(), json()],
  },
];

export default config;
