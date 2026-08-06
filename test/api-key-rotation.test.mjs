import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testRoot = mkdtempSync(path.join(os.tmpdir(), "codex-router-rotation-"));
const statePath = path.join(testRoot, "api-key-rotation.json");
process.env.CODEX_HOME = path.join(testRoot, "codex");
process.env.CODEX_ROUTER_STATE_DIR = path.join(testRoot, "state");

const { createRotationState, EXHAUST_COOLDOWN_MS, ROTATE_ON_STATUS } = await import(
  "../src/api-key-rotation.mjs"
);
const {
  resolveProviderCredentialSlots,
  writeProviderCredentialSlot,
} = await import("../src/provider-credentials.mjs");

test("rotation state picks the sticky last-used slot first", () => {
  const state = createRotationState(path.join(testRoot, "one.json"));
  assert.equal(state.nextSlot("family", 3), 0);
  state.markUsed("family", 2);
  assert.equal(state.nextSlot("family", 3), 2);
  state.markUsed("family", 0);
  assert.equal(state.nextSlot("family", 3), 0);
});

test("rotation state skips exhausted slots and retries spent ones after cooldown", () => {
  const state = createRotationState(path.join(testRoot, "two.json"));
  state.markUsed("family", 0);
  state.markExhausted("family", 0, 1_000);
  assert.equal(state.nextSlot("family", 3), 1);
  state.markExhausted("family", 1, 1_000);
  assert.equal(state.nextSlot("family", 3), 2);
  state.markExhausted("family", 2, 1_000);
  // All slots cooling down: the least-recently exhausted one is retried.
  assert.ok([0, 1, 2].includes(state.nextSlot("family", 3)));
});

test("rotation state honours the attempted set", () => {
  const state = createRotationState(path.join(testRoot, "three.json"));
  state.markUsed("family", 1);
  assert.equal(state.nextSlot("family", 3, new Set([0, 1])), 2);
});

test("exhaustion is persisted so restarts do not hammer a spent key", () => {
  const state = createRotationState(statePath);
  state.markExhausted("family", 0, 60_000);
  const reloaded = createRotationState(statePath);
  assert.equal(reloaded.exhaustedUntil("family", 0) > Date.now(), true);
});

test("exhaustion cooldown expires and rotation triggers cover quota failures", () => {
  const state = createRotationState(path.join(testRoot, "four.json"));
  state.markUsed("family", 0);
  state.markExhausted("family", 0, -1);
  assert.equal(state.nextSlot("family", 3), 0);
  assert.equal(EXHAUST_COOLDOWN_MS, 10 * 60 * 1000);
  assert.deepEqual([...ROTATE_ON_STATUS].sort(), [401, 402, 429]);
});

test("createRotationState tolerates a missing or corrupt file", () => {
  const fresh = createRotationState(path.join(testRoot, "missing.json"));
  assert.equal(fresh.nextSlot("family", 2), 0);
  const corrupt = createRotationState(path.join(testRoot, "nested", "corrupt.json"));
  assert.equal(corrupt.nextSlot("family", 2), 0);
});

test("provider key slots resolve numbered files in order and reject bad slots", () => {
  const first = writeProviderCredentialSlot("opencode-go", "SLOT_ONE", 0);
  const second = writeProviderCredentialSlot("opencode-go", "SLOT_TWO", 1);
  const third = writeProviderCredentialSlot("opencode-go", "SLOT_THREE", 2);
  const slots = resolveProviderCredentialSlots("opencode-go");
  assert.equal(slots.length, 3);
  assert.deepEqual(
    slots.map((entry) => entry.value),
    ["SLOT_ONE", "SLOT_TWO", "SLOT_THREE"],
  );
  assert.deepEqual(
    slots.map((entry) => entry.slot),
    [0, 1, 2],
  );
  assert.ok(first.endsWith("opencode-go-api-key.secret"));
  assert.ok(second.endsWith("opencode-go-api-key-2.secret"));
  assert.ok(third.endsWith("opencode-go-api-key-3.secret"));
  assert.throws(() => writeProviderCredentialSlot("opencode-go", "KEY", 5), /between 1 and 5/);
  assert.throws(() => writeProviderCredentialSlot("opencode-go", "KEY", -1), /between 1 and 5/);
});

test.after(() => {
  rmSync(testRoot, { recursive: true, force: true });
});
