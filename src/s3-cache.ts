// Adapted from the MIT-licensed runs-on/cache backend and actions/cache archive implementation.
import * as cacheUtils from "@actions/cache/lib/internal/cacheUtils";
import { createTar, extractTar, listTar } from "@actions/cache/lib/internal/tar";
import type { CompressionMethod } from "@actions/cache/lib/internal/constants";
import type { DownloadOptions } from "@actions/cache/lib/options";
import * as core from "@actions/core";
import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import crypto from "crypto";
import { createReadStream } from "fs";
import { open, type FileHandle } from "fs/promises";
import path from "path";

import { newestObjectForPrefix } from "./s3-objects";

const VERSION_SALT = "1.0";
const MULTIPART_PART_SIZE = 8 * 1024 * 1024;
const DOWNLOAD_PART_SIZE = 16 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 8;
const DOWNLOAD_RETRIES = 5;
const DOWNLOAD_TIMEOUT_MS = 30_000;

interface S3CacheConfig {
  bucket: string;
  prefix: string;
  region: string | undefined;
  repository: string;
}

let client: S3Client | undefined;

export function isFeatureAvailable(): boolean {
  const config = getConfig();
  if (!config.bucket) {
    return false;
  }
  if (!config.region) {
    core.warning("S3 cache requires AWS_REGION or AWS_DEFAULT_REGION.");
    return false;
  }
  return true;
}

export async function restoreCache(
  paths: string[],
  primaryKey: string,
  restoreKeys: string[] = [],
  options?: DownloadOptions,
  enableCrossOsArchive = false,
): Promise<string | undefined> {
  validatePaths(paths);
  validateKeys([primaryKey, ...restoreKeys]);

  const config = requireConfig();
  const compressionMethod = await cacheUtils.getCompressionMethod();
  const namespace = cacheNamespace(paths, compressionMethod, enableCrossOsArchive, config);
  const s3 = getClient(config);
  const exactObjectKey = objectKey(namespace, primaryKey);

  try {
    if (options?.lookupOnly) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: exactObjectKey }));
        core.info("Lookup only - exact S3 cache entry found.");
        return primaryKey;
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
      }
    } else {
      const archivePath = await createArchivePath(compressionMethod);
      try {
        await downloadObject(s3, config.bucket, exactObjectKey, archivePath);
        await restoreArchive(archivePath, compressionMethod);
        return primaryKey;
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
      } finally {
        await removeArchive(archivePath);
      }
    }

    for (const restoreKey of restoreKeys) {
      const match = await newestObjectForPrefix(s3, config.bucket, objectKey(namespace, restoreKey));
      if (!match) {
        continue;
      }

      const matchedKey = match.key.slice(`${namespace}/`.length);
      if (options?.lookupOnly) {
        core.info("Lookup only - matching S3 cache entry found.");
        return matchedKey;
      }

      const archivePath = await createArchivePath(compressionMethod);
      try {
        await downloadObject(s3, config.bucket, match.key, archivePath);
        await restoreArchive(archivePath, compressionMethod);
        return matchedKey;
      } finally {
        await removeArchive(archivePath);
      }
    }
  } catch (error) {
    core.warning(`Failed to restore S3 cache: ${errorMessage(error)}`);
  }

  return undefined;
}

export async function saveCache(paths: string[], key: string): Promise<number> {
  validatePaths(paths);
  validateKeys([key]);

  const config = requireConfig();
  const compressionMethod = await cacheUtils.getCompressionMethod();
  const cachePaths = await cacheUtils.resolvePaths(paths);
  if (cachePaths.length === 0) {
    throw new Error("Path Validation Error: Path(s) specified in the action do(es) not exist, hence no cache is being saved.");
  }

  const archiveFolder = await cacheUtils.createTempDirectory();
  const archivePath = path.join(archiveFolder, cacheUtils.getCacheFileName(compressionMethod));
  try {
    await createTar(archiveFolder, cachePaths, compressionMethod);
    if (core.isDebug()) {
      await listTar(archivePath, compressionMethod);
    }

    const size = cacheUtils.getArchiveFileSizeInBytes(archivePath);
    core.info(`Cache Size: ~${Math.round(size / (1024 * 1024))} MB (${size} B)`);

    const upload = new Upload({
      client: getClient(config),
      params: {
        Bucket: config.bucket,
        Key: objectKey(cacheNamespace(paths, compressionMethod, false, config), key),
        Body: createReadStream(archivePath),
      },
      partSize: MULTIPART_PART_SIZE,
      queueSize: 4,
    });
    upload.on("httpUploadProgress", (progress) => {
      if (progress.part) {
        core.info(`Uploaded S3 cache part ${progress.part}.`);
      }
    });
    await upload.done();
    core.info("S3 cache saved successfully.");
    return 1;
  } catch (error) {
    core.warning(`Failed to save S3 cache: ${errorMessage(error)}`);
    return -1;
  } finally {
    await removeArchive(archivePath);
  }
}

function getConfig(): S3CacheConfig {
  return {
    bucket: core.getInput("s3-bucket"),
    prefix: normalizePrefix(core.getInput("s3-prefix") || "rust-cache/"),
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    repository: process.env.GITHUB_REPOSITORY || "local",
  };
}

function requireConfig(): S3CacheConfig {
  const config = getConfig();
  if (!config.bucket) {
    throw new Error("S3 cache requires the s3-bucket input.");
  }
  if (!config.region) {
    throw new Error("S3 cache requires AWS_REGION or AWS_DEFAULT_REGION.");
  }
  return config;
}

function getClient(config: S3CacheConfig): S3Client {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3;
  client ??= new S3Client({
    region: config.region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
  return client;
}

function cacheNamespace(
  paths: string[],
  compressionMethod: CompressionMethod,
  enableCrossOsArchive: boolean,
  config: S3CacheConfig,
): string {
  const versionComponents = [...paths, compressionMethod];
  if (process.platform === "win32" && !enableCrossOsArchive) {
    versionComponents.push("windows-only");
  }
  versionComponents.push(VERSION_SALT);
  const version = crypto.createHash("sha256").update(versionComponents.join("|")).digest("hex");
  return [config.prefix, "cache", config.repository, version].filter(Boolean).join("/");
}

function objectKey(namespace: string, key: string): string {
  return `${namespace}/${key}`;
}

function normalizePrefix(prefix: string): string {
  return prefix.trim().replace(/^\/+|\/+$/g, "");
}

function validatePaths(paths: string[]): void {
  if (paths.length === 0) {
    throw new Error("Path Validation Error: At least one directory or file path is required.");
  }
}

function validateKeys(keys: string[]): void {
  if (keys.length > 10) {
    throw new Error("Key Validation Error: Keys are limited to a maximum of 10.");
  }
  for (const key of keys) {
    if (key.length > 512) {
      throw new Error(`Key Validation Error: ${key} cannot be larger than 512 characters.`);
    }
    if (key.includes(",")) {
      throw new Error(`Key Validation Error: ${key} cannot contain commas.`);
    }
  }
}

async function createArchivePath(compressionMethod: CompressionMethod): Promise<string> {
  return path.join(await cacheUtils.createTempDirectory(), cacheUtils.getCacheFileName(compressionMethod));
}

async function restoreArchive(archivePath: string, compressionMethod: CompressionMethod): Promise<void> {
  if (core.isDebug()) {
    await listTar(archivePath, compressionMethod);
  }
  const size = cacheUtils.getArchiveFileSizeInBytes(archivePath);
  if (size === 0) {
    throw new Error("Downloaded S3 cache archive is empty.");
  }
  core.info(`Cache Size: ~${Math.round(size / (1024 * 1024))} MB (${size} B)`);
  await extractTar(archivePath, compressionMethod);
  core.info("S3 cache restored successfully.");
}

async function downloadObject(s3: S3Client, bucket: string, key: string, archivePath: string): Promise<void> {
  const metadata = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const contentLength = metadata.ContentLength;
  if (contentLength === undefined) {
    throw new Error("S3 did not return the cache object size.");
  }

  const partCount = Math.ceil(contentLength / DOWNLOAD_PART_SIZE);
  const workerCount = Math.min(DOWNLOAD_CONCURRENCY, partCount);
  const startedAt = Date.now();
  const archive = await open(archivePath, "w");
  const abortController = new AbortController();
  let nextPart = 0;
  let bytesDownloaded = 0;
  let failure: unknown;

  try {
    await archive.truncate(contentLength);
    core.info(`Downloading S3 cache in ${workerCount} concurrent ${DOWNLOAD_PART_SIZE / 1024 / 1024} MB parts.`);

    const workers = Array.from({ length: workerCount }, async () => {
      while (!abortController.signal.aborted) {
        const part = nextPart++;
        if (part >= partCount) {
          return;
        }

        const start = part * DOWNLOAD_PART_SIZE;
        const end = Math.min(start + DOWNLOAD_PART_SIZE, contentLength) - 1;
        try {
          const bytes = await downloadPart(s3, bucket, key, start, end, metadata.ETag, abortController.signal);
          await writePart(archive, bytes, start);
          bytesDownloaded += bytes.length;
        } catch (error) {
          failure ??= error;
          abortController.abort();
          return;
        }
      }
    });

    await Promise.all(workers);
    if (failure) {
      throw failure;
    }
    if (bytesDownloaded !== contentLength) {
      throw new Error(`Downloaded ${bytesDownloaded} bytes of a ${contentLength} byte S3 cache object.`);
    }

    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const megabytesPerSecond = contentLength / 1024 / 1024 / elapsedSeconds;
    core.info(`Downloaded S3 cache at ${megabytesPerSecond.toFixed(1)} MB/s.`);
  } finally {
    await archive.close();
  }
}

async function downloadPart(
  s3: S3Client,
  bucket: string,
  key: string,
  start: number,
  end: number,
  eTag: string | undefined,
  signal: AbortSignal,
): Promise<Buffer> {
  for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt++) {
    try {
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          Range: `bytes=${start}-${end}`,
          ...(eTag ? { IfMatch: eTag } : {}),
        }),
        { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]) },
      );
      if (!response.Body) {
        throw new Error(`S3 returned an empty response for cache range ${start}-${end}.`);
      }

      const bytes = Buffer.from(await response.Body.transformToByteArray());
      const expectedLength = end - start + 1;
      if (bytes.length !== expectedLength) {
        throw new Error(`S3 returned ${bytes.length} bytes for cache range ${start}-${end}; expected ${expectedLength}.`);
      }
      return bytes;
    } catch (error) {
      if (signal.aborted || attempt === DOWNLOAD_RETRIES) {
        throw error;
      }
      core.debug(`Retrying S3 cache range ${start}-${end} after attempt ${attempt}: ${errorMessage(error)}`);
    }
  }

  throw new Error(`Failed to download S3 cache range ${start}-${end}.`);
}

async function writePart(archive: FileHandle, bytes: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const result = await archive.write(bytes, offset, bytes.length - offset, position + offset);
    if (result.bytesWritten === 0) {
      throw new Error(`Failed to write S3 cache bytes at offset ${position + offset}.`);
    }
    offset += result.bytesWritten;
  }
}

async function removeArchive(archivePath: string): Promise<void> {
  try {
    await cacheUtils.unlinkFile(archivePath);
  } catch {
    // Cleanup is best-effort; a leftover archive must not fail the cache operation.
  }
}

function isNotFound(error: unknown): boolean {
  const s3Error = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return s3Error.name === "NoSuchKey" || s3Error.Code === "NoSuchKey" || s3Error.$metadata?.httpStatusCode === 404;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
