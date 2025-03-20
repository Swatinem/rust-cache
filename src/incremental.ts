// import * as core from "@actions/core";
// import * as io from "@actions/io";
// import { CARGO_HOME } from "./config";
// import { exists } from "./utils";
// import { Packages } from "./workspace";

import fs from "fs";
import path from "path";

export type MtimeData = {
  roots: string[],
  times: {
    [key: string]: number
  }
};

export async function saveMtimes(targetDirs: string[]): Promise<MtimeData> {
  let data: MtimeData = {
    roots: [],
    times: {},
  };
  let stack: string[] = [];

  // Collect all the incremental files
  for (const dir of targetDirs) {
    for (const maybeProfile of await fs.promises.readdir(dir)) {
      const profileDir = path.join(dir, maybeProfile);
      const incrementalDir = path.join(profileDir, "incremental");
      if (fs.existsSync(incrementalDir)) {
        stack.push(incrementalDir);
      }
    }
  }

  // Save the stack as the roots - we cache these directly
  data.roots = stack.slice();

  while (stack.length > 0) {
    const dirName = stack.pop()!;
    const dir = await fs.promises.opendir(dirName);

    for await (const dirent of dir) {
      if (dirent.isDirectory()) {
        stack.push(path.join(dirName, dirent.name));
      } else {
        const fileName = path.join(dirName, dirent.name);
        const { mtime } = await fs.promises.stat(fileName);
        data.times[fileName] = mtime.getTime();
      }
    }
  }

  return data;
}
