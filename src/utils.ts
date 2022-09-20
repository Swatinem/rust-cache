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
    core.info(`[warning] Command failed: ${cmd} ${args.join(" ")}`);
    core.info(`[warning] ${stderr}`);
    throw e;
  }
  return stdout;
}

export async function withRetries<T>(
  operation: () => Promise<T>,
  maxRetryAttempts: number,
  isRetriable: (error: unknown) => boolean
): Promise<T> {
  let attemptsLeft = maxRetryAttempts;
  while (true) {
    try {
      return await operation();
    } catch (e: unknown) {
      attemptsLeft -= 1;
      if (attemptsLeft <= 0) {
        throw e;
      }
      if (!isRetriable(e)) {
        throw e;
      }
      core.info(
        `[warning] Retrying after an error, ${attemptsLeft} attempts left, error: ${e}`
      );
    }
  }
}

class TimeoutError extends Error {}

export async function withTimeout<T>(
  operation: (onTimeout: Promise<void>) => Promise<T>,
  timeoutMs: null | number
): Promise<T> {
  const timeout = timeoutMs
    ? new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      })
    : new Promise<never>(() => {});

  const timeoutSym = Symbol("timeout" as const);
  const racingTimeout = timeout.then(() => timeoutSym);

  const result = await Promise.race([racingTimeout, operation(timeout)]);
  if (result === timeoutSym) {
    throw new TimeoutError("operation timeout");
  }
  return result as Awaited<T>;
}
