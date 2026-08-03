import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const stateDir = mkdtempSync(path.join(os.tmpdir(), "codex-router-catalog-lkg-"));
process.env.MODEL_ROUTER_STATE_DIR = stateDir;

const {
  LKG_FRESH_MS,
  LKG_STALE_MS,
  providerLkgPath,
  readProviderLkg,
  writeProviderLkg,
} = await import("../src/catalog-lkg.mjs");

test.after(() => rmSync(stateDir, { recursive: true, force: true }));

test("LKG replacement is atomic and preserves the complete canonical payload", () => {
  const fetchedAt = "2026-08-03T10:00:00.000Z";
  writeProviderLkg("opencode-go", {
    models: ["qwen3.8-max"],
    fetchedAt,
  });
  writeProviderLkg("opencode-go", {
    models: ["qwen3.8-max", "grok-4.6"],
    fetchedAt,
  });

  const target = providerLkgPath("opencode-go");
  assert.equal(existsSync(target), true);
  assert.deepEqual(JSON.parse(readFileSync(target, "utf8")).models, [
    "grok-4.6",
    "qwen3.8-max",
  ]);
  assert.equal(
    readdirSync(path.dirname(target)).some((name) => name.includes(".tmp.")),
    false,
  );
});

test("LKG transitions from fresh to stale to unavailable and reports invalid data", () => {
  const fetchedAt = Date.parse("2026-08-03T10:00:00.000Z");
  writeProviderLkg("state-provider", {
    models: ["qwen3.8-max"],
    fetchedAt: new Date(fetchedAt).toISOString(),
  });

  assert.equal(
    readProviderLkg("state-provider", { now: fetchedAt + LKG_FRESH_MS - 1 }).state,
    "fresh",
  );
  assert.equal(
    readProviderLkg("state-provider", { now: fetchedAt + LKG_FRESH_MS + 1 }).state,
    "stale",
  );
  assert.equal(
    readProviderLkg("state-provider", { now: fetchedAt + LKG_STALE_MS + 1 }).state,
    "unavailable",
  );

  writeFileSync(providerLkgPath("invalid-provider"), "{not-json\n", "utf8");
  const invalid = readProviderLkg("invalid-provider");
  assert.equal(invalid.state, "invalid");
  assert.deepEqual(invalid.models, []);
  assert.equal(readProviderLkg("missing-provider"), null);
});
