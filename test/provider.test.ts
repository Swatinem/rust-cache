import assert from "node:assert/strict";
import test from "node:test";

import { selectCacheProvider } from "../src/utils.js";

test("github is the default provider", () => {
  assert.equal(selectCacheProvider("", "", () => {}), "github");
});

test("selects S3 when its bucket is configured", () => {
  assert.equal(selectCacheProvider("s3", "ci-cache", () => {}), "s3");
});

test("an empty S3 bucket warns and falls back to github", () => {
  const warnings: string[] = [];
  assert.equal(selectCacheProvider("s3", "", (warning) => warnings.push(warning)), "github");
  assert.match(warnings[0], /s3-bucket is empty/);
});
