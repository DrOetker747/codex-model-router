import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
