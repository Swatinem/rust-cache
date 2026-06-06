import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import type { RollupWatchOptions } from "rollup";

const config: RollupWatchOptions = {
  input: ["./.build/src/restore.js", "./.build/src/save.js"],
  output: { dir: "./dist", format: "es" },
  plugins: [nodeResolve({ preferBuiltins: true }), commonjs(), json()],
};
export default config;
