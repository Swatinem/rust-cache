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
