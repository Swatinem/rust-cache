// import * as core from "@actions/core";
// import * as io from "@actions/io";
import fs from "fs";
import path from "path";

// import { CARGO_HOME } from "./config";
// import { exists } from "./utils";
// import { Packages } from "./workspace";

export async function saveMtimes(targetDirs: string[]): Promise<Map<string, number>> {
  let cache = new Map<string, number>();
  let stack = targetDirs.slice();

  while (stack.length > 0) {
    const dirName = stack.pop()!;
    const dir = await fs.promises.opendir(dirName);

    for await (const dirent of dir) {
      if (dirent.isDirectory()) {
        stack.push(path.join(dirName, dirent.name));
      } else {
        const fileName = path.join(dirName, dirent.name);
        const { mtime } = await fs.promises.stat(fileName);
        cache.set(fileName, mtime.getTime());
      }
    }
  }

  return cache;
}
