import * as buildjetCache from "@actions/buildjet-cache";
import * as ghCache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";

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

export function getCacheHandler() {
  const cacheProvider = core.getInput("cache-provider");
  switch (cacheProvider) {
    case "github":
      core.info("Using Github Cache.");
      return ghCache;
    case "buildjet":
      core.info("Using Buildjet Cache.");
      return buildjetCache;
    default:
      throw new Error("Only currently support github and buildjet caches");
  }
}
