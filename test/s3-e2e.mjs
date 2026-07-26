import { CopyObjectCommand, CreateBucketCommand, DeleteObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { MinioContainer } from "@testcontainers/minio";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const bucket = "s3-cache-integration";
const dataDirectory = ".s3-cache-data";
const payload = path.join(dataDirectory, "payload");
const runnerTemp = process.env.RUNNER_TEMP || path.join(tmpdir(), "rust-cache-s3-e2e");
process.env.RUNNER_TEMP = runnerTemp;
// The save step prunes CARGO_HOME; point it at a scratch directory so a local
// run never touches the developer's real ~/.cargo.
process.env.CARGO_HOME = path.join(runnerTemp, "cargo-home");

Object.assign(process.env, {
  "INPUT_ADD-JOB-ID-KEY": "true",
  "INPUT_ADD-RUST-ENVIRONMENT-HASH-KEY": "true",
  "INPUT_CACHE-ALL-CRATES": "false",
  "INPUT_CACHE-BIN": "false",
  "INPUT_CACHE-DIRECTORIES": dataDirectory,
  "INPUT_CACHE-ON-FAILURE": "false",
  "INPUT_CACHE-PROVIDER": "s3",
  "INPUT_CACHE-TARGETS": "false",
  "INPUT_CACHE-WORKSPACE-CRATES": "false",
  "INPUT_CMD-FORMAT": "{0}",
  "INPUT_PREFIX-KEY": "v0-rust",
  "INPUT_S3-BUCKET": bucket,
  "INPUT_S3-PREFIX": "rust-cache/",
  "INPUT_SAVE-IF": "true",
  "INPUT_SHARED-KEY": "s3-e2e",
  "INPUT_WORKSPACES": "tests",
});

const minio = await new MinioContainer("minio/minio:RELEASE.2025-04-22T22-12-26Z").start();
try {
  const endpoint = minio.getConnectionUrl();
  delete process.env.AWS_PROFILE;
  delete process.env.AWS_SESSION_TOKEN;
  delete process.env.AWS_WEB_IDENTITY_TOKEN_FILE;
  delete process.env.AWS_ROLE_ARN;
  Object.assign(process.env, {
    AWS_ACCESS_KEY_ID: minio.getUsername(),
    AWS_SECRET_ACCESS_KEY: minio.getPassword(),
    AWS_REGION: "us-east-1",
    AWS_ENDPOINT_URL_S3: endpoint,
  });

  const s3 = new S3Client({ endpoint, forcePathStyle: true, region: process.env.AWS_REGION });
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));

  await mkdir(dataDirectory, { recursive: true });
  await mkdir(runnerTemp, { recursive: true });
  // The payload must span several 8 MB upload and 16 MB download parts to
  // exercise the multipart upload and parallel download paths.
  await run("dd", ["if=/dev/urandom", `of=${payload}`, "bs=1M", "count=24", "status=none"]);
  const payloadHash = await hashFile(payload);

  const statePath = path.join(runnerTemp, "rust-cache-state");
  const outputPath = path.join(runnerTemp, "rust-cache-output");
  const actionEnv = { ...process.env, GITHUB_STATE: statePath, GITHUB_OUTPUT: outputPath };

  await empty(statePath, outputPath);
  await run("node", ["dist/restore.js"], actionEnv);
  await run("cargo", ["check", "--manifest-path", "tests/Cargo.toml"]);

  const savedConfig = await readActionState(statePath);
  const saveLog = await run("node", ["dist/save.js"], { ...actionEnv, STATE_RUST_CACHE_CONFIG: savedConfig });
  const uploadedParts = saveLog.match(/Uploaded S3 cache part/g) ?? [];
  assert.ok(uploadedParts.length > 1, "expected a multipart S3 upload");

  await empty(statePath, outputPath);
  await rm("tests/target", { recursive: true, force: true });
  await rm(dataDirectory, { recursive: true, force: true });
  const exactRestoreLog = await run("node", ["dist/restore.js"], actionEnv);
  await assertHash(payload, payloadHash);
  await run("cargo", ["check", "--manifest-path", "tests/Cargo.toml"]);
  assert.equal(await readFile(statePath, "utf8"), "", "exact restore must not save post-action state");
  const exactSaveLog = await run("node", ["dist/save.js"], actionEnv);
  assert.ok(exactRestoreLog.includes("full match: true"), "expected an exact restore");
  assert.ok(exactSaveLog.includes("Cache up-to-date"), "expected save to be skipped after an exact restore");

  const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
  const key = Contents.find((object) => object.Key)?.Key;
  if (!key) {
    throw new Error("Expected the initial S3 cache object.");
  }
  await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: `${key}-fallback-old`, CopySource: `${bucket}/${key}` }));
  // S3 LastModified has one-second granularity; the two copies need distinct timestamps.
  await sleep(1100);
  await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: `${key}-fallback-new`, CopySource: `${bucket}/${key}` }));
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

  await empty(statePath, outputPath);
  await rm(dataDirectory, { recursive: true, force: true });
  const fallbackRestoreLog = await run("node", ["dist/restore.js"], { ...actionEnv, "INPUT_SAVE-IF": "false" });
  await assertHash(payload, payloadHash);
  assert.ok(fallbackRestoreLog.includes('fallback-new" full match: false'), "expected the newest prefix fallback");
} finally {
  await rm(dataDirectory, { recursive: true, force: true });
  await minio.stop();
}

async function empty(...paths) {
  await Promise.all(paths.map((file) => writeFile(file, "")));
}

async function readActionState(statePath) {
  const state = await readFile(statePath, "utf8");
  const match = state.match(/^RUST_CACHE_CONFIG<<[^\n]+\n([^\n]+)$/m);
  if (!match) {
    throw new Error("The restore action did not save its cache configuration.");
  }
  return match[1];
}

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function assertHash(file, expected) {
  assert.equal(await hashFile(file), expected, `Unexpected contents for ${file}.`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function run(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`${command} exited with status ${code}.`));
      }
    });
  });
}
