import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as s3Cache from "./s3-cache";
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
  cmdFormat: string,
  cmd: string,
  options: exec.ExecOptions = {},
): Promise<string> {
  cmd = cmdFormat.replace("{0}", cmd);
  let stdout = "";
  let stderr = "";
  try {
    await exec.exec(cmd, [], {
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
      command: cmd,
      stderr,
    };
    throw e;
  }
  return stdout;
}

export interface CacheProvider {
  name: string;
  cache: typeof s3Cache;
}

export function getCacheProvider(): CacheProvider {
  const cacheProvider = core.getInput("cache-provider");
  if (cacheProvider !== "s3") {
    throw new Error(`The \`cache-provider\` \`${cacheProvider}\` is not valid. Only \`s3\` is supported.`);
  }

  return {
    name: cacheProvider,
    cache: s3Cache,
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
