import * as buildjetCache from "@actions/buildjet-cache";
import * as ghCache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";

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
    core.error(`Command failed: ${cmd} ${args.join(" ")}`);
    core.error(stderr);
    throw e;
  }
  return stdout;
}

export function getCacheHandler() {
    const cacheProvider = core.getInput("cache-provider");
    switch (cacheProvider) {
      case 'github':
        core.info ("Using Github Cache.");
        return ghCache;
      case 'buildjet':
        core.info ("Using Buildjet Cache.");
        return buildjetCache;
      default:
        throw new Error("Only currently support github and buildjet caches");
    }
}