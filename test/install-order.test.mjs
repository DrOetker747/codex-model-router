import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("clean install adds Node dependencies before catalog synchronization", () => {
  const source = readFileSync(path.join(root, "bin", "install"), "utf8");
  const dependencies = source.indexOf("npm ci --omit=dev");
  const synchronization = source.indexOf("node src/sync-auto-models.mjs");
  assert.notEqual(dependencies, -1);
  assert.notEqual(synchronization, -1);
  assert.ok(dependencies < synchronization);
});
