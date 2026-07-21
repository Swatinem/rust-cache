import assert from "node:assert/strict";
import test from "node:test";
import type { ListObjectsV2Command, ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";

import { newestObjectForPrefix, type S3ObjectLister } from "../src/s3-objects.js";

test("paginates S3 listings and selects the globally newest object", async () => {
  const requests: Array<{ Prefix?: string; ContinuationToken?: string }> = [];
  const pages = [
    {
      Contents: [
        { Key: "rust-cache/cache/repo/version/key-old", LastModified: new Date("2026-01-01T00:00:00Z") },
        { Key: "rust-cache/cache/repo/version/key-middle", LastModified: new Date("2026-01-02T00:00:00Z") },
      ],
      IsTruncated: true,
      NextContinuationToken: "next-page",
    },
    {
      Contents: [{ Key: "rust-cache/cache/repo/version/key-new", LastModified: new Date("2026-01-03T00:00:00Z") }],
      IsTruncated: false,
    },
  ] as ListObjectsV2CommandOutput[];
  const client: S3ObjectLister = {
    async send(command: ListObjectsV2Command) {
      requests.push(command.input);
      return pages.shift()!;
    },
  };

  const match = await newestObjectForPrefix(client, "cache-bucket", "rust-cache/cache/repo/version/key-");

  assert.equal(match?.key, "rust-cache/cache/repo/version/key-new");
  assert.deepEqual(requests, [
    { Bucket: "cache-bucket", Prefix: "rust-cache/cache/repo/version/key-", ContinuationToken: undefined },
    { Bucket: "cache-bucket", Prefix: "rust-cache/cache/repo/version/key-", ContinuationToken: "next-page" },
  ]);
});
