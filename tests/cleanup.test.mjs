import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { cleanTargetDir } from "../.build/src/cleanup.js";

const packages = [{ name: "kept", version: "1.0.0", path: "", targets: [] }];

async function temporaryTarget(t) {
  const target = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rust-cache-cleanup-"));
  t.after(() => fs.promises.rm(target, { recursive: true, force: true }));
  return target;
}

async function writeFile(file, content = "artifact") {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, content);
}

async function createProfile(profile) {
  for (const directory of ["build", ".fingerprint", "deps"]) {
    await fs.promises.mkdir(path.join(profile, directory), { recursive: true });
  }
}

for (const present of [[], ["target"], ["trybuild"]]) {
  test(`cleanup tolerates missing nested test targets when ${JSON.stringify(present)} exist`, async (t) => {
    const target = await temporaryTarget(t);
    await fs.promises.mkdir(path.join(target, "tests"));
    for (const directory of present) {
      await fs.promises.mkdir(path.join(target, "tests", directory));
    }

    await cleanTargetDir(target, packages);
    assert.deepEqual((await fs.promises.readdir(path.join(target, "tests"))).sort(), present);
  });
}

test("nested test artifacts are pruned before their parent cleanup continues", async (t) => {
  const target = await temporaryTarget(t);
  const testsDir = path.join(target, "tests");
  const staleFiles = [];
  const keptFiles = [];
  for (const directory of ["target", "trybuild"]) {
    const deps = path.join(testsDir, directory, "debug", "deps");
    await createProfile(path.dirname(deps));
    const stale = path.join(deps, "libstale-123.rlib");
    const kept = path.join(deps, "libkept-123.rlib");
    await writeFile(stale);
    await writeFile(kept);
    staleFiles.push(stale);
    keptFiles.push(kept);
  }

  const opendir = fs.promises.opendir;
  const parentObservations = [];
  t.mock.method(fs.promises, "opendir", (...args) => {
    if (args[0] === testsDir) {
      // Observe the order at the parent operation without relying on filesystem timing.
      parentObservations.push(staleFiles.every((file) => !fs.existsSync(file)));
    }
    return opendir(...args);
  });

  await cleanTargetDir(target, packages);
  assert.deepEqual(parentObservations, [true]);
  for (const file of staleFiles) {
    assert.equal(fs.existsSync(file), false);
  }
  for (const file of keptFiles) {
    assert.equal(await fs.promises.readFile(file, "utf8"), "artifact");
  }
});

for (const checkTimestamp of [false, true]) {
  test(`package artifacts are discarded without pruning their sources (checkTimestamp=${checkTimestamp})`, async (t) => {
    const target = await temporaryTarget(t);
    const packageDir = path.join(target, "package");
    await writeFile(path.join(packageDir, "example-1.0.0.crate"));
    await writeFile(path.join(packageDir, "example-1.0.0", "tests", "fixtures", "input.txt"));
    const kept = path.join(target, "debug", "deps", "libkept-123.rlib");
    await createProfile(path.dirname(path.dirname(kept)));
    await writeFile(kept);

    const opendir = fs.promises.opendir;
    const scannedPackagePaths = [];
    t.mock.method(fs.promises, "opendir", (...args) => {
      if (args[0] === packageDir || args[0].startsWith(packageDir + path.sep)) {
        scannedPackagePaths.push(args[0]);
      }
      return opendir(...args);
    });

    await cleanTargetDir(target, packages, checkTimestamp);
    assert.deepEqual(scannedPackagePaths, []);
    assert.equal(fs.existsSync(packageDir), false);
    assert.equal(await fs.promises.readFile(kept, "utf8"), "artifact");
  });
}

test("package removal is limited to target roots", async (t) => {
  const target = await temporaryTarget(t);
  const profile = path.join(target, "x86_64-unknown-linux-gnu", "package");
  await createProfile(profile);
  const kept = path.join(profile, "deps", "libkept-123.rlib");
  const stale = path.join(profile, "deps", "libstale-123.rlib");
  await writeFile(kept);
  await writeFile(stale);

  await cleanTargetDir(target, packages);
  assert.equal(await fs.promises.readFile(kept, "utf8"), "artifact");
  assert.equal(fs.existsSync(stale), false);
});
