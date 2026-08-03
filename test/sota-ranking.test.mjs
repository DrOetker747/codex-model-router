import assert from "node:assert/strict";
import test from "node:test";

import {
  compareModelRecords,
  compareModelVersions,
  parseModelFamilyAndVersion,
  rankSotaModels,
  selectSotaModelIds,
} from "../src/sota-ranking.mjs";

test("ranks qwen decimal versions numerically and keeps variants separate", () => {
  assert.deepEqual(parseModelFamilyAndVersion("qwen3.8-max"), {
    family: "qwen",
    key: "qwen:max",
    versionParts: [3, 8],
    variant: "max",
  });
  assert.deepEqual(
    [...selectSotaModelIds(["qwen3.7-max", "qwen3.8-max", "qwen3.7-plus"])].sort(),
    ["qwen3.7-plus", "qwen3.8-max"],
  );
});

test("compares multi-part versions numerically", () => {
  assert.equal(compareModelVersions([4, 10], [4, 9]), 1);
  assert.deepEqual(
    [...selectSotaModelIds(["grok-4.9", "grok-4.10"])],
    ["grok-4.10"],
  );
});

test("keeps deepseek flash and pro as separate SOTA variants", () => {
  assert.deepEqual(
    [...selectSotaModelIds([
      "deepseek-v4-flash",
      "deepseek-v5-flash",
      "deepseek-v4-pro",
      "deepseek-v5-pro",
    ])].sort(),
    ["deepseek-v5-flash", "deepseek-v5-pro"],
  );
});

test("uses valid created metadata only for a same-version tie", () => {
  assert.deepEqual(
    [...selectSotaModelIds([
      { id: "kimi-k3", created: "2026-08-01T00:00:00.000Z" },
      { id: "kimi-k3-code", created: "2026-08-02T00:00:00.000Z" },
    ])],
    ["kimi-k3-code"],
  );
  assert.deepEqual(
    [...selectSotaModelIds([
      { id: "grok-4.9", created: "not-a-date" },
      { id: "grok-4.10" },
    ])],
    ["grok-4.10"],
  );
});

test("keeps parsed version as the primary signal when older metadata is newer", () => {
  assert.deepEqual(
    [...selectSotaModelIds([
      { id: "grok-4.9", created: "2026-08-03T00:00:00.000Z" },
      { id: "grok-4.10", created: "2026-08-01T00:00:00.000Z" },
    ])],
    ["grok-4.10"],
  );
});

test("parses every supported family without exact-version rules", () => {
  const fixtures = [
    ["kimi-k12.4-code", "kimi", "standard", [12, 4]],
    ["minimax-m10.2", "minimax", "standard", [10, 2]],
    ["grok-11.7", "grok", "standard", [11, 7]],
    ["glm-14.3", "glm", "standard", [14, 3]],
    ["gpt-12.6-luna", "gpt", "luna", [12, 6]],
    ["deepseek-v10.4-flash", "deepseek", "flash", [10, 4]],
    ["deepseek-v10.4-pro", "deepseek", "pro", [10, 4]],
    ["qwen12.9-max", "qwen", "max", [12, 9]],
    ["qwen12.9-plus", "qwen", "plus", [12, 9]],
    ["mimo-v10.5", "mimo", "standard", [10, 5]],
    ["mimo-v10.5-pro", "mimo", "pro", [10, 5]],
    ["hy12.8", "hy", "standard", [12, 8]],
  ];

  for (const [id, family, variant, versionParts] of fixtures) {
    assert.deepEqual(parseModelFamilyAndVersion(id), {
      family,
      key: `${family}:${variant}`,
      versionParts,
      variant,
    });
  }
});

test("keeps malformed and unknown IDs deterministic but outside SOTA", () => {
  const models = ["unknown-model", "hy3-preview", "hy3", "unknown-model"];
  assert.deepEqual([...selectSotaModelIds(models)], ["hy3"]);
  assert.deepEqual(
    parseModelFamilyAndVersion("unknown-model"),
    undefined,
  );
});

test("returns the same order for the same catalog in any input order", () => {
  const models = [
    "qwen3.7-plus",
    "grok-4.9",
    "deepseek-v4-pro",
    "qwen3.8-max",
    "grok-4.10",
    "deepseek-v4-flash",
  ];
  const first = [...selectSotaModelIds(models)];
  const second = [...selectSotaModelIds([...models].reverse())];
  assert.deepEqual(first, second);
});

test("uses priority, capabilities, provider, and canonical id as stable tie-breaks", () => {
  const common = { created: "2026-08-03T10:00:00.000Z" };
  assert.ok(compareModelRecords(
    { id: "kimi-k3-b", ...common, priority: 1 },
    { id: "kimi-k3-a", ...common, priority: 2 },
  ) > 0);
  assert.ok(compareModelRecords(
    { id: "kimi-k3-a", ...common, priority: 2, capabilities: ["tools", "vision"] },
    { id: "kimi-k3-b", ...common, priority: 2, capabilities: ["tools"] },
  ) > 0);
  assert.ok(compareModelRecords(
    { id: "kimi-k3-z", ...common, priority: 2, capabilities: ["tools"], provider: "a" },
    { id: "kimi-k3-a", ...common, priority: 2, capabilities: ["tools"], provider: "b" },
  ) > 0);
  assert.ok(compareModelRecords(
    { id: "kimi-k3-a", ...common },
    { id: "kimi-k3-b", ...common },
  ) > 0);

  const records = [
    { id: "kimi-k3-z", ...common, provider: "b" },
    { id: "kimi-k3-a", ...common, provider: "a" },
  ];
  assert.deepEqual(rankSotaModels(records).map((model) => model.id), [
    "kimi-k3-a",
    "kimi-k3-z",
  ]);
  assert.deepEqual([...selectSotaModelIds(records)], ["kimi-k3-a"]);
  assert.deepEqual([...selectSotaModelIds([
    { id: "kimi-k3-a", ...common, capabilities: ["tools"] },
    { id: "kimi-k3-z", ...common, capabilities: ["reasoning", "tools"] },
  ])], ["kimi-k3-z"]);
});
