import * as core from "@actions/core";
// import * as io from "@actions/io";
import fs from "fs";
import path from "path";

// import { CARGO_HOME } from "./config";
import { exists } from "./utils";
// import { Packages } from "./workspace";

export async function restoreIncremental(targetDir: string) {
  core.debug(`restoring incremental directory "${targetDir}"`);

  let dir = await fs.promises.opendir(targetDir);
  for await (const dirent of dir) {
    if (dirent.isDirectory()) {
      let dirName = path.join(dir.path, dirent.name);
      // is it a profile dir, or a nested target dir?
      let isNestedTarget =
        (await exists(path.join(dirName, "CACHEDIR.TAG"))) || (await exists(path.join(dirName, ".rustc_info.json")));

      try {
        if (isNestedTarget) {
          await restoreIncremental(dirName);
        } else {
          await restoreIncrementalProfile(dirName);
        } restoreIncrementalProfile
      } catch { }
    }
  }
}

async function restoreIncrementalProfile(dirName: string) {
  core.debug(`restoring incremental profile directory "${dirName}"`);
  const incrementalJson = path.join(dirName, "incremental-restore.json");
  if (await exists(incrementalJson)) {
    const contents = await fs.promises.readFile(incrementalJson, "utf8");
    const { modifiedTimes } = JSON.parse(contents);

    core.debug(`restoring incremental profile directory "${dirName}" with ${modifiedTimes} files`);

    // Write the mtimes to all the files in the profile directory
    for (const fileName of Object.keys(modifiedTimes)) {
      const mtime = modifiedTimes[fileName];
      const filePath = path.join(dirName, fileName);
      await fs.promises.utimes(filePath, new Date(mtime), new Date(mtime));
    }
  } else {
    core.debug(`incremental-restore.json not found for ${dirName}`);
  }
}
