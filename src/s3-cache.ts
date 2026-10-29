import * as core from "@actions/core";
import awsLite from "@aws-lite/client";
// @ts-ignore
import awsS3 from "@aws-lite/s3";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const DOWNLOAD_CONCURRENCY = 32;
const DOWNLOAD_PART_SIZE = 16 * 1024 * 1024; // 16 MB
const UPLOAD_PART_SIZE = 32 * 1024 * 1024; // 32 MB
const UPLOAD_CONCURRENCY = 32;

let _client: any = null;

async function getClient() {
  if (!_client) {
    const region =
      core.getInput("s3-region") ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION;
    _client = await awsLite({ region, plugins: [awsS3] });
  }
  return _client;
}

export function getBucket(): string {
  return core.getInput("s3-bucket");
}

export function isFeatureAvailable(): boolean {
  return !!getBucket();
}

export async function restoreCache(
  paths: string[],
  primaryKey: string,
  restoreKeys?: string[],
  options?: { lookupOnly?: boolean },
): Promise<string | undefined> {
  void paths;
  const bucket = getBucket();
  const aws = await getClient();

  // Try exact primary key first, then each restore key (prefix match)
  for (const key of [primaryKey, ...(restoreKeys ?? [])]) {
    let matchedKey: string | undefined;

    try {
      await aws.S3.HeadObject({ Bucket: bucket, Key: key });
      matchedKey = key;
    } catch {
      // Not an exact match — try prefix listing
      const result = await aws.S3.ListObjectsV2({ Bucket: bucket, Prefix: key, MaxKeys: 1 });
      const obj = result.Contents?.[0];
      if (obj?.Key) {
        matchedKey = obj.Key;
      }
    }

    if (!matchedKey) continue;

    if (!options?.lookupOnly) {
      await downloadAndExtract(aws, bucket, matchedKey);
    }
    return matchedKey;
  }

  return undefined;
}

export async function saveCache(paths: string[], key: string): Promise<string> {
  const existingPaths: string[] = [];
  for (const path of paths) {
    try {
      await fs.lstat(path);
      existingPaths.push(path);
    } catch {
      core.info(`Skipping non-existent cache path: ${path}`);
    }
  }

  if (existingPaths.length === 0) {
    core.warning("None of the cache paths exist, not saving cache.");
    return key;
  }

  const bucket = getBucket();
  const aws = await getClient();

  const tmpFile = join(tmpdir(), `rust-cache-upload-${Date.now()}.tar.zst`);
  try {
    // Write tar+zstd to temp file
    await new Promise<void>((resolve, reject) => {
      const tar = spawn(
        "tar",
        ["--use-compress-program=zstd -T0 -1", "-cf", tmpFile, "-C", "/", "--", ...existingPaths],
        { stdio: ["ignore", "inherit", "inherit"] },
      );
      tar.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`tar exited with code ${code}`)),
      );
      tar.on("error", reject);
    });

    const { size } = await fs.stat(tmpFile);
    core.info(`Uploading cache (${(size / (1024 * 1024)).toFixed(1)} MB) to S3...`);

    await parallelUpload(aws, bucket, key, tmpFile, size);

    core.info(`Upload complete.`);
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }

  return key;
}

async function parallelUpload(
  aws: any,
  bucket: string,
  key: string,
  filePath: string,
  fileSize: number,
): Promise<void> {
  const { UploadId } = await aws.S3.CreateMultipartUpload({ Bucket: bucket, Key: key });

  const numParts = Math.ceil(fileSize / UPLOAD_PART_SIZE);
  let uploaded = 0;
  let lastLog = Date.now();
  let lastBytes = 0;

  const logProgress = () => {
    const now = Date.now();
    if (now - lastLog >= 1000) {
      const elapsed = (now - lastLog) / 1000;
      const mb = (uploaded / (1024 * 1024)).toFixed(1);
      const mbps = ((uploaded - lastBytes) / (1024 * 1024) / elapsed).toFixed(1);
      core.info(`Uploading cache... ${mb} MB (${mbps} MB/s)`);
      lastLog = now;
      lastBytes = uploaded;
    }
  };

  const parts: { PartNumber: number; ETag: string }[] = new Array(numParts);
  const fh = await fs.open(filePath, "r");
  try {
    for (let batch = 0; batch < numParts; batch += UPLOAD_CONCURRENCY) {
      const batchEnd = Math.min(batch + UPLOAD_CONCURRENCY, numParts);
      await Promise.all(
        Array.from({ length: batchEnd - batch }, async (_, i) => {
          const partNum = batch + i + 1; // S3 part numbers are 1-based
          const start = (partNum - 1) * UPLOAD_PART_SIZE;
          const chunkSize = Math.min(UPLOAD_PART_SIZE, fileSize - start);
          const buf = Buffer.allocUnsafe(chunkSize);
          await fh.read(buf, 0, chunkSize, start);
          const resp = await aws.S3.UploadPart({
            Bucket: bucket,
            Key: key,
            UploadId,
            PartNumber: partNum,
            Body: buf,
          });
          uploaded += chunkSize;
          logProgress();
          parts[partNum - 1] = { PartNumber: partNum, ETag: resp.ETag };
        }),
      );
    }
  } catch (err) {
    await aws.S3.AbortMultipartUpload({ Bucket: bucket, Key: key, UploadId }).catch(() => {});
    throw err;
  } finally {
    await fh.close();
  }

  await aws.S3.CompleteMultipartUpload({
    Bucket: bucket,
    Key: key,
    UploadId,
    MultipartUpload: { Parts: parts },
  });
}

async function getObjectSize(aws: any, bucket: string, key: string): Promise<number> {
  // Range: bytes=0-0 to get ContentRange with total size
  const resp = await aws.S3.GetObject({
    Bucket: bucket,
    Key: key,
    Range: "bytes=0-0",
    rawResponsePayload: true,
  });
  // ContentRange: "bytes 0-0/TOTAL"
  const match = String(resp.ContentRange ?? "").match(/\/(\d+)$/);
  if (!match) throw new Error(`Unexpected ContentRange: ${resp.ContentRange}`);
  return parseInt(match[1], 10);
}

async function downloadAndExtract(aws: any, bucket: string, key: string): Promise<void> {
  core.info(`Downloading from S3 bucket "${bucket}", key "${key}"`);

  const totalSize = await getObjectSize(aws, bucket, key);
  core.info(`Object size: ${(totalSize / (1024 * 1024)).toFixed(1)} MB`);

  const tmpFile = join(tmpdir(), `rust-cache-download-${Date.now()}.tar.zst`);

  try {
    // Pre-allocate the file
    try {
      await new Promise<void>((resolve, reject) => {
        const p = spawn("fallocate", ["-l", String(totalSize), tmpFile]);
        p.on("close", (code) => (code === 0 ? resolve() : reject()));
        p.on("error", reject);
      });
    } catch {
      // fallocate not available (e.g. macOS) — fall back to creating an empty file
      await fs.writeFile(tmpFile, Buffer.alloc(0));
    }

    // Download all chunks concurrently
    const numParts = Math.ceil(totalSize / DOWNLOAD_PART_SIZE);
    let downloaded = 0;
    let lastLog = Date.now();
    let lastBytes = 0;

    const logProgress = () => {
      const now = Date.now();
      if (now - lastLog >= 1000) {
        const elapsed = (now - lastLog) / 1000;
        const mb = (downloaded / (1024 * 1024)).toFixed(1);
        const mbps = ((downloaded - lastBytes) / (1024 * 1024) / elapsed).toFixed(1);
        core.info(`Downloading cache... ${mb} MB (${mbps} MB/s)`);
        lastLog = now;
        lastBytes = downloaded;
      }
    };

    const fh = await fs.open(tmpFile, "r+");
    try {
      // Process parts in batches of DOWNLOAD_CONCURRENCY
      for (let batch = 0; batch < numParts; batch += DOWNLOAD_CONCURRENCY) {
        const batchEnd = Math.min(batch + DOWNLOAD_CONCURRENCY, numParts);
        await Promise.all(
          Array.from({ length: batchEnd - batch }, (_, i) => {
            const part = batch + i;
            const start = part * DOWNLOAD_PART_SIZE;
            const end = Math.min(start + DOWNLOAD_PART_SIZE - 1, totalSize - 1);
            return aws.S3.GetObject({
              Bucket: bucket,
              Key: key,
              Range: `bytes=${start}-${end}`,
              rawResponsePayload: true,
            }).then((resp: any) => {
              const buf: Buffer = resp.Body;
              downloaded += buf.length;
              logProgress();
              return fh.write(buf, 0, buf.length, start);
            });
          }),
        );
      }
    } finally {
      await fh.close();
    }

    core.info(`Download complete: ${(downloaded / (1024 * 1024)).toFixed(1)} MB`);

    // Extract
    await new Promise<void>((resolve, reject) => {
      const tar = spawn(
        "tar",
        ["--use-compress-program=zstd -d", "-xf", tmpFile, "-C", "/"],
        { stdio: ["ignore", "inherit", "inherit"] },
      );
      tar.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`tar exited with code ${code}`)),
      );
      tar.on("error", reject);
    });
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}
