import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("model catalogs normalize duplicate ids and preserve qwen3.8-max", async () => {
  const { normalizeModelCatalog } = await import("../src/model-discovery.mjs");
  assert.deepEqual(
    normalizeModelCatalog({
      data: [
        { id: " qwen3.8-max " },
        { id: "qwen3.8-max" },
        { id: "" },
        { id: "grok-4.6" },
      ],
    }),
    ["grok-4.6", "qwen3.8-max"],
  );
});

test("model catalog records preserve safe ranking metadata only", async () => {
  const { normalizeModelCatalogRecords } = await import("../src/model-discovery.mjs");
  assert.deepEqual(
    normalizeModelCatalogRecords({
      data: [
        {
          id: " kimi-k3-code ",
          created: "2026-08-03T10:00:00.000Z",
          provider: " OpenCode-Go ",
          priority: 7,
          capabilities: { tools: true, vision: false, reasoning: true },
          api_key: "must-not-survive",
          credential: { token: "must-not-survive" },
          nested: { unsafe: true },
        },
        { id: "grok-4.10", created: "not-a-date", priority: "high" },
      ],
    }),
    [
      { id: "grok-4.10" },
      {
        id: "kimi-k3-code",
        created: "2026-08-03T10:00:00.000Z",
        provider: "opencode-go",
        priority: 7,
        capabilities: ["reasoning", "tools"],
      },
    ],
  );
});

test("provider catalog fetch reports invalid JSON, timeout, and non-2xx responses", async () => {
  const { fetchProviderCatalog } = await import("../src/model-discovery.mjs");

  await assert.rejects(
    fetchProviderCatalog("opencode-go", {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("invalid json");
        },
      }),
    }),
    (error) => {
      assert.match(error.message, /invalid JSON/i);
      assert.match(error.cause?.message || "", /invalid json/i);
      return true;
    },
  );
  await assert.rejects(
    fetchProviderCatalog("opencode-go", {
      fetchImpl: async () => {
        throw new DOMException("timed out", "TimeoutError");
      },
    }),
    (error) => {
      assert.match(error.message, /timed out|timeout/i);
      assert.equal(error.cause?.name, "TimeoutError");
      return true;
    },
  );
  await assert.rejects(
    fetchProviderCatalog("opencode-go", {
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: { message: "temporarily unavailable" } }),
      }),
    }),
    /503|temporarily unavailable/i,
  );
});

test("live discovery requires explicit endpoint capability metadata", async () => {
  const { fetchProviderCatalog } = await import("../src/model-discovery.mjs");
  await assert.rejects(
    fetchProviderCatalog({
      id: "static-provider",
      displayName: "Static Provider",
      kind: "openai-compatible",
      baseUrl: "https://static.invalid/v1",
    }, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }) }),
    /endpoint capability/i,
  );
});

test("model discovery compares fixtures without needing or exposing a key", () => {
  const testRoot = mkdtempSync(path.join(os.tmpdir(), "codex-router-discovery-"));
  const fixture = path.join(testRoot, "models.json");
  writeFileSync(
    fixture,
    JSON.stringify({ data: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v5-preview" }] }),
  );
  try {
    const output = execFileSync(
      process.execPath,
      ["src/model-discovery.mjs", "deepseek", "--fixture", fixture, "--json"],
      { cwd: root, encoding: "utf8", env: { ...process.env, DEEPSEEK_API_KEY: "" } },
    );
    const result = JSON.parse(output);
    assert.deepEqual(result.unregistered, ["deepseek-v5-preview"]);
    assert.ok(result.unavailable.includes("deepseek-v4-flash"));
    assert.doesNotMatch(output, /Bearer|api[_-]?key/i);
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});
