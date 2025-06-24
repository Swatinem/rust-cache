import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as buildjetCache from "@actions/buildjet-cache";
import * as warpbuildCache from "@actions/warpbuild-cache";
import * as ghCache from "@actions/cache";
import fs from "fs";

export function reportError(e: any) {
  const { commandFailed } = e;
  if (commandFailed) {
    core.error(`Command failed: ${commandFailed.command}`);
    core.error(commandFailed.stderr);
  } else {
    core.error(`${e.stack}`);
  }
}

export async function getCmdOutput(
  cmd: string,
  args: Array<string> = [],
  options: exec.ExecOptions = {},
): Promise<string> {
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
  } catch (e) {
    (e as any).commandFailed = {
      command: `${cmd} ${args.join(" ")}`,
      stderr,
    };
    throw e;
  }
  return stdout;
}

export interface GhCache {
  isFeatureAvailable: typeof ghCache.isFeatureAvailable;
  restoreCache: typeof ghCache.restoreCache;
  saveCache: (paths: string[], key: string) => Promise<string | number>;
}

export interface CacheProvider {
  name: string;
  cache: GhCache;
}

export function getCacheProvider(): CacheProvider {
  const cacheProvider = core.getInput("cache-provider");
  let cache: GhCache;
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

export async function exists(path: string) {
  try {
    await fs.promises.access(path);
    return true;
  } catch {
    return false;
  }
}
