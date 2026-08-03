import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const functionStateDir = mkdtempSync(path.join(os.tmpdir(), "enabled-provider-sync-"));
process.env.MODEL_ROUTER_STATE_DIR = functionStateDir;
const { pickerModelIds, syncEnabledProviderCatalogs } = await import("../src/sync-auto-models.mjs");
const { PROVIDERS } = await import("../src/model-registry.mjs");
const { providerLkgPath, writeProviderLkg } = await import("../src/catalog-lkg.mjs");
const { readUserModels, userModelEntry, writeUserModels } = await import("../src/user-models.mjs");

test.after(() => rmSync(functionStateDir, { recursive: true, force: true }));

test("ranks dynamic providers, preserves static picker behavior, and honors hide-all", () => {
  const dynamic = {
    id: "fixture-picker-dynamic",
    modelDiscovery: { endpoint: "/models" },
  };
  const staticProvider = { id: "fixture-picker-static" };
  const hidden = {
    id: "fixture-picker-hidden",
    modelDiscovery: { endpoint: "/models" },
    pickerPolicy: "hide-all",
  };
  for (const provider of [dynamic, staticProvider, hidden]) {
    PROVIDERS.set(provider.id, Object.freeze(provider));
  }
  try {
    assert.deepEqual(
      [...pickerModelIds(dynamic.id, ["grok-4.9", "grok-4.10"])],
      ["grok-4.10"],
    );
    assert.deepEqual(
      [...pickerModelIds(staticProvider.id, ["grok-4.9", "grok-4.10"])],
      ["grok-4.9", "grok-4.10"],
    );
    assert.deepEqual([...pickerModelIds(hidden.id, ["grok-4.10"])], []);
  } finally {
    for (const provider of [dynamic, staticProvider, hidden]) {
      PROVIDERS.delete(provider.id);
    }
  }
});

test("syncs two enabled providers, skips the disabled provider, and keeps qwen3.8-max", async () => {
  const calls = [];
  const fixtures = {
    "opencode-go": { data: [{ id: "qwen3.8-max" }, { id: "qwen3.8-max" }] },
    "opencode-free": { data: [{ id: "big-pickle" }] },
    deepseek: { data: [{ id: "should-not-be-fetched" }] },
  };

  const result = await syncEnabledProviderCatalogs({
    enabledProviders: ["opencode-go", "opencode-free"],
    fetchCatalog: async (providerId) => {
      calls.push(providerId);
      return fixtures[providerId];
    },
    now: () => Date.parse("2026-08-03T10:00:00.000Z"),
    sleep: async () => {},
  });

  assert.deepEqual(calls, ["opencode-go", "opencode-free"]);
  assert.ok(result.models.some((model) => model.provider === "opencode-go" && model.upstreamModel === "qwen3.8-max"));
  assert.ok(result.models.some((model) => model.provider === "opencode-free" && model.upstreamModel === "big-pickle"));
  assert.equal(result.models.some((model) => model.upstreamModel === "should-not-be-fetched"), false);
  assert.deepEqual(result.lkg["opencode-go"].models, ["qwen3.8-max"]);
});

test("retries a failed catalog with bounded backoff and preserves the previous LKG", async () => {
  const calls = [];
  const delays = [];
  const first = await syncEnabledProviderCatalogs({
    enabledProviders: ["opencode-go"],
    fetchCatalog: async () => ({ data: [{ id: "qwen3.8-max" }] }),
    now: () => Date.parse("2026-08-03T10:00:00.000Z"),
    sleep: async (delay) => delays.push(delay),
  });
  assert.deepEqual(first.lkg["opencode-go"].models, ["qwen3.8-max"]);

  const failed = await syncEnabledProviderCatalogs({
    enabledProviders: ["opencode-go"],
    fetchCatalog: async () => {
      calls.push("failed");
      throw new Error("catalog timeout");
    },
    now: () => Date.parse("2026-08-03T10:01:00.000Z"),
    sleep: async (delay) => delays.push(delay),
  });

  assert.equal(calls.length, 3);
  assert.ok(delays.length >= 2);
  assert.ok(delays.every((delay) => delay <= 2_000));
  assert.deepEqual(failed.lkg["opencode-go"].models, ["qwen3.8-max"]);
  assert.equal(failed.lkg["opencode-go"].state, "unavailable");
  assert.ok(failed.models.some((model) => model.upstreamModel === "qwen3.8-max"));
});

test("uses declared discovery capability for a new enabled provider and preserves static providers", async () => {
  const dynamicProvider = {
    id: "fixture-dynamic-provider",
    displayName: "Fixture Dynamic Provider",
    kind: "openai-compatible",
    ownedBy: "fixture",
    baseUrl: "https://fixture.invalid/v1",
    modelDiscovery: { endpoint: "/models" },
    credential: { environment: [], file: "fixture.secret" },
  };
  PROVIDERS.set(dynamicProvider.id, Object.freeze(dynamicProvider));
  const staticEntry = userModelEntry({
    providerId: "deepseek",
    upstreamId: "deepseek-existing",
    priority: 100,
  });
  writeUserModels([staticEntry]);
  const calls = [];
  try {
    const result = await syncEnabledProviderCatalogs({
      enabledProviders: [dynamicProvider.id, "deepseek"],
      fetchCatalog: async (providerId) => {
        calls.push(providerId);
        return { data: [{ id: "qwen3.8-max" }] };
      },
      now: () => Date.parse("2026-08-03T10:00:00.000Z"),
      sleep: async () => {},
    });
    assert.deepEqual(calls, [dynamicProvider.id]);
    assert.ok(result.models.some((model) => model.provider === dynamicProvider.id));
    assert.deepEqual(readUserModels().find((model) => model.provider === "deepseek"), staticEntry);
  } finally {
    PROVIDERS.delete(dynamicProvider.id);
  }
});

test("selects latest SOTA models for every enabled provider and hides older models", async () => {
  const dynamicProvider = {
    id: "fixture-ranking-provider",
    displayName: "Fixture Ranking Provider",
    kind: "openai-compatible",
    ownedBy: "fixture",
    baseUrl: "https://fixture.invalid/v1",
    modelDiscovery: { endpoint: "/models" },
    credential: { environment: [], file: "fixture.secret" },
  };
  PROVIDERS.set(dynamicProvider.id, Object.freeze(dynamicProvider));
  writeUserModels([]);
  try {
    await syncEnabledProviderCatalogs({
      enabledProviders: [dynamicProvider.id],
      fetchCatalog: async () => ({
        data: [{ id: "grok-4.9" }, { id: "grok-4.10" }],
      }),
      now: () => Date.parse("2026-08-03T10:00:00.000Z"),
      sleep: async () => {},
    });

    const models = readUserModels();
    assert.equal(
      models.find((model) => model.upstreamModel === "grok-4.9")?.pickerVisibility,
      "hide",
    );
    assert.equal(
      models.find((model) => model.upstreamModel === "grok-4.10")?.pickerVisibility,
      "list",
    );
    assert.deepEqual(
      models.map((model) => model.upstreamModel).sort(),
      ["grok-4.10", "grok-4.9"],
    );
  } finally {
    PROVIDERS.delete(dynamicProvider.id);
    writeUserModels([]);
  }
});

test("fresh sync uses safe created metadata for a same-version SOTA tie", async () => {
  const dynamicProvider = {
    id: "fixture-created-provider",
    displayName: "Fixture Created Provider",
    kind: "openai-compatible",
    ownedBy: "fixture",
    baseUrl: "https://fixture.invalid/v1",
    modelDiscovery: { endpoint: "/models" },
    credential: { environment: [], file: "fixture.secret" },
  };
  PROVIDERS.set(dynamicProvider.id, Object.freeze(dynamicProvider));
  writeUserModels([]);
  try {
    await syncEnabledProviderCatalogs({
      enabledProviders: [dynamicProvider.id],
      fetchCatalog: async () => ({ data: [
        { id: "kimi-k7-alpha", created: "2026-08-01T00:00:00.000Z" },
        { id: "kimi-k7-beta", created: "2026-08-02T00:00:00.000Z" },
      ] }),
      now: () => Date.parse("2026-08-03T10:00:00.000Z"),
      sleep: async () => {},
    });

    const byId = new Map(readUserModels().map((model) => [model.upstreamModel, model]));
    assert.equal(byId.get("kimi-k7-alpha")?.pickerVisibility, "hide");
    assert.equal(byId.get("kimi-k7-beta")?.pickerVisibility, "list");
  } finally {
    PROVIDERS.delete(dynamicProvider.id);
    writeUserModels([]);
  }
});

test("LKG string ids still select the latest numeric version", async () => {
  const dynamicProvider = {
    id: "fixture-lkg-ranking-provider",
    displayName: "Fixture LKG Ranking Provider",
    kind: "openai-compatible",
    ownedBy: "fixture",
    baseUrl: "https://fixture.invalid/v1",
    modelDiscovery: { endpoint: "/models" },
    credential: { environment: [], file: "fixture.secret" },
  };
  PROVIDERS.set(dynamicProvider.id, Object.freeze(dynamicProvider));
  writeUserModels([]);
  writeProviderLkg(dynamicProvider.id, {
    models: ["grok-4.9", "grok-4.10"],
    fetchedAt: "2026-08-03T09:59:00.000Z",
  });
  try {
    await syncEnabledProviderCatalogs({
      enabledProviders: [dynamicProvider.id],
      fetchCatalog: async () => { throw new Error("catalog timeout"); },
      now: () => Date.parse("2026-08-03T10:00:00.000Z"),
      sleep: async () => {},
    });

    const byId = new Map(readUserModels().map((model) => [model.upstreamModel, model]));
    assert.equal(byId.get("grok-4.9")?.pickerVisibility, "hide");
    assert.equal(byId.get("grok-4.10")?.pickerVisibility, "list");
  } finally {
    PROVIDERS.delete(dynamicProvider.id);
    writeUserModels([]);
    unlinkSync(providerLkgPath(dynamicProvider.id));
  }
});

test("retains missing and unknown routes but hides them from SOTA", async () => {
  const dynamicProvider = {
    id: "fixture-retention-provider",
    displayName: "Fixture Retention Provider",
    kind: "openai-compatible",
    ownedBy: "fixture",
    baseUrl: "https://fixture.invalid/v1",
    modelDiscovery: { endpoint: "/models" },
    credential: { environment: [], file: "fixture.secret" },
  };
  PROVIDERS.set(dynamicProvider.id, Object.freeze(dynamicProvider));
  writeUserModels([
    userModelEntry({
      providerId: dynamicProvider.id,
      upstreamId: "grok-4.9",
      priority: 100,
      autoDiscovered: dynamicProvider.id,
      pickerVisibility: "list",
    }),
    userModelEntry({
      providerId: dynamicProvider.id,
      upstreamId: "unknown-legacy-model",
      priority: 101,
      autoDiscovered: dynamicProvider.id,
      pickerVisibility: "list",
    }),
  ]);
  try {
    await syncEnabledProviderCatalogs({
      enabledProviders: [dynamicProvider.id],
      fetchCatalog: async () => ({
        data: [{ id: "grok-4.10" }, { id: "unknown-live-model" }],
      }),
      now: () => Date.parse("2026-08-03T10:00:00.000Z"),
      sleep: async () => {},
    });

    const byId = new Map(
      readUserModels()
        .filter((model) => model.provider === dynamicProvider.id)
        .map((model) => [model.upstreamModel, model]),
    );
    assert.deepEqual([...byId.keys()].sort(), [
      "grok-4.10",
      "grok-4.9",
      "unknown-legacy-model",
      "unknown-live-model",
    ]);
    assert.equal(byId.get("grok-4.10")?.pickerVisibility, "list");
    assert.equal(byId.get("grok-4.9")?.pickerVisibility, "hide");
    assert.equal(byId.get("unknown-legacy-model")?.pickerVisibility, "hide");
    assert.equal(byId.get("unknown-live-model")?.pickerVisibility, "hide");
    assert.ok([...byId.values()].every((model) => model.listed));
  } finally {
    PROVIDERS.delete(dynamicProvider.id);
    writeUserModels([]);
  }
});

test("missing or invalid LKG never removes existing selected user models", async () => {
  const existing = userModelEntry({
    providerId: "opencode-go",
    upstreamId: "qwen3.8-max",
    priority: 100,
    autoDiscovered: "opencode-go",
    pickerVisibility: "list",
  });
  for (const mode of ["missing", "invalid"]) {
    writeUserModels([existing]);
    writeProviderLkg("opencode-go", {
      models: ["qwen3.8-max"],
      fetchedAt: "2026-08-03T10:00:00.000Z",
    });
    if (mode === "missing") {
      unlinkSync(providerLkgPath("opencode-go"));
    } else {
      writeFileSync(providerLkgPath("opencode-go"), "{invalid\n", "utf8");
    }

    const result = await syncEnabledProviderCatalogs({
      enabledProviders: ["opencode-go"],
      fetchCatalog: async () => {
        throw new Error("catalog timeout");
      },
      now: () => Date.parse("2026-08-03T10:01:00.000Z"),
      sleep: async () => {},
    });
    assert.deepEqual(readUserModels(), [existing]);
    assert.equal(result.providers[0].changed, false);
    assert.equal(readUserModels()[0].pickerVisibility, "list");
  }
});

test("OpenCode Go catalog sync adds every new model with the correct protocol", () => {
  const testRoot = mkdtempSync(path.join(os.tmpdir(), "opencode-go-sync-"));
  const stateDir = path.join(testRoot, "state");
  const fixture = path.join(testRoot, "models.json");
  writeFileSync(
    fixture,
    `${JSON.stringify({
      object: "list",
      data: [
        { id: "kimi-k3" },
        { id: "kimi-k2.7-code" },
        { id: "grok-4.5" },
        { id: "grok-4.6" },
        { id: "glm-5.1" },
        { id: "glm-5.2" },
        { id: "qwen3.7-max" },
        { id: "qwen3.7-plus" },
        { id: "qwen3.6-plus" },
        { id: "minimax-m3" },
        { id: "minimax-m2.7" },
        { id: "gpt-5.6-luna" },
        { id: "deepseek-v4-flash" },
        { id: "deepseek-v4-pro" },
        { id: "mimo-v2-omni" },
        { id: "mimo-v2.5" },
        { id: "mimo-v2.5-pro" },
        { id: "hy3-preview" },
        { id: "hy3" },
      ],
    })}\n`,
  );

  try {
    const output = execFileSync(
      process.execPath,
      ["src/sync-auto-models.mjs", "opencode-go", "--fixture", fixture],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, MODEL_ROUTER_STATE_DIR: stateDir },
      },
    );
    const result = JSON.parse(output).results[0];
    assert.equal(result.changed, true);
    assert.equal(result.discovered, 19);
    assert.equal(result.models, 18);

    const models = JSON.parse(
      readFileSync(path.join(stateDir, "user-models.json"), "utf8"),
    ).models;
    const byId = Object.fromEntries(models.map((model) => [model.upstreamModel, model]));
    assert.equal(byId["grok-4.5"].protocol, "openai");
    assert.equal(byId["qwen3.7-max"].protocol, "anthropic");
    assert.equal(byId["minimax-m3"].protocol, "anthropic");
    assert.equal(byId["gpt-5.6-luna"].protocol, "responses");
    assert.equal(byId["kimi-k3"], undefined);
    assert.deepEqual(
      models
        .filter((model) => model.pickerVisibility === "list")
        .map((model) => model.upstreamModel)
        .sort(),
      [
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "glm-5.2",
        "gpt-5.6-luna",
        "grok-4.6",
        "hy3",
        "mimo-v2.5",
        "mimo-v2.5-pro",
        "minimax-m3",
        "qwen3.7-max",
        "qwen3.7-plus",
      ],
    );

    const repeatedOutput = execFileSync(
      process.execPath,
      ["src/sync-auto-models.mjs", "opencode-go", "--fixture", fixture],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, MODEL_ROUTER_STATE_DIR: stateDir },
      },
    );
    const repeatedResult = JSON.parse(repeatedOutput).results[0];
    assert.equal(repeatedResult.changed, false);
    assert.equal(repeatedResult.models, 18);
    assert.equal(
      JSON.parse(readFileSync(path.join(stateDir, "user-models.json"), "utf8"))
        .models.length,
      18,
    );

    execFileSync(process.execPath, ["src/litellm-config.mjs"], {
      cwd: root,
      env: { ...process.env, MODEL_ROUTER_STATE_DIR: stateDir },
      stdio: "ignore",
    });
    const config = readFileSync(path.join(stateDir, "litellm.yaml"), "utf8");
    assert.match(config, /model: "openai\/opencode-go-grok-4-5"/);
    assert.match(config, /model: "anthropic\/opencode-go-qwen3-7-max"/);
    const responsesBlock = config.match(
      /model_name: "opencode-go-gpt-5-6-luna"[\s\S]*?(?=\n  - model_name:|\nlitellm_settings:)/,
    )?.[0];
    assert.ok(responsesBlock);
    assert.doesNotMatch(responsesBlock, /use_chat_completions_api/);
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});

test("OpenCode Free sync excludes every paid Zen model", () => {
  const testRoot = mkdtempSync(path.join(os.tmpdir(), "opencode-free-sync-"));
  const stateDir = path.join(testRoot, "state");
  const fixture = path.join(testRoot, "free-models.json");
  try {
    writeFileSync(fixture, JSON.stringify({
      data: [
        { id: "big-pickle" },
        { id: "deepseek-v4-flash-free" },
        { id: "mimo-v2.5-free" },
        { id: "gpt-5.6-sol" },
        { id: "claude-opus-5" },
      ],
    }));
    execFileSync(
      process.execPath,
      ["src/sync-auto-models.mjs", "opencode-free", "--fixture", fixture],
      { cwd: root, env: { ...process.env, MODEL_ROUTER_STATE_DIR: stateDir } },
    );
    const models = JSON.parse(
      readFileSync(path.join(stateDir, "user-models.json"), "utf8"),
    ).models;
    assert.deepEqual(models.map((model) => model.upstreamModel).sort(), [
      "big-pickle",
      "deepseek-v4-flash-free",
      "mimo-v2.5-free",
    ]);
    assert.ok(models.every((model) => model.pickerVisibility === "hide"));
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});
