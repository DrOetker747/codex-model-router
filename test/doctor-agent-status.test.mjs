import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { rebuildExternalSubagentProfiles } from "../src/codex-agent-catalog.mjs";

const root = path.resolve();
const doctor = path.join(root, "src", "doctor.mjs");

const visibleQwen = {
  slug: "qwen-plan/qwen3.7-max",
  provider: "qwen-plan",
  listed: true,
  display_name: "Qwen3.7 Max",
  displayName: "Qwen3.7 Max",
  priority: 12,
  visibility: "list",
  inputModalities: ["text"],
  contextWindow: 262144,
  autoCompact: 235000,
  defaultEffort: "high",
  reasoningLevels: [{ effort: "high", description: "Adaptive reasoning" }],
};

const hiddenDeepSeek = {
  ...visibleQwen,
  slug: "deepseek/deepseek-v4-pro",
  provider: "deepseek",
  display_name: "DeepSeek V4 Pro",
  displayName: "DeepSeek V4 Pro",
  priority: 7,
  visibility: "hide",
};

function writeJson(target, value) {
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function runDoctor({ selectedProfiles }) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "codex-router-doctor-agent-status-"));
  const codexHome = path.join(tempRoot, "codex");
  const stateDir = path.join(tempRoot, "state");
  const agentsDir = path.join(codexHome, "agents");
  const selectionPath = path.join(stateDir, "selected-external-agents.json");
  const mergedCatalogPath = path.join(stateDir, "merged-models.json");
  const userAgent = path.join(agentsDir, "router-model-user-file.toml");
  mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
  writeFileSync(userAgent, 'name = "user-owned"\n', { mode: 0o600 });
  writeJson(selectionPath, { version: 1, profiles: selectedProfiles });
  writeJson(mergedCatalogPath, {
    catalogUpdatedAt: "2026-08-03T12:00:00.000Z",
    models: [visibleQwen, hiddenDeepSeek],
  });

  rebuildExternalSubagentProfiles({
    mergedCatalog: { models: [visibleQwen, hiddenDeepSeek] },
    selectedProfiles,
    agentsDir,
    verifiedProfiles: [],
  });

  const result = spawnSync(
    process.execPath,
    [doctor, "--json"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        CODEX_ROUTER_STATE_DIR: stateDir,
        MODEL_ROUTER_STATE_DIR: stateDir,
        MODEL_ROUTER_EXTERNAL_AGENT_SELECTION_PATH: selectionPath,
        MODEL_ROUTER_VERIFIED_EXTERNAL_AGENT_RECORD_PATH: path.join(
          stateDir,
          "missing-verification-record.json",
        ),
        MODEL_ROUTER_TARGET: "codex",
        CODEX_BIN: process.execPath,
        MODEL_ROUTER_PORT: "65534",
      },
    },
  );
  try {
    assert.ok(result.stdout, result.stderr || "doctor returned no JSON output");
    const report = JSON.parse(result.stdout);
    const check = report.checks.find((item) => item.name === "Routed model agents");
    assert.ok(check, "doctor report must contain the routed model agents check");
    assert.equal(readFileSync(userAgent, "utf8"), 'name = "user-owned"\n');
    assert.equal(existsSync(path.join(agentsDir, "router-model-deepseek-deepseek-v4-pro.toml")), selectedProfiles.length > 0);
    return check;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("doctor ignores a hidden unselected model and reports only the visible profile", () => {
  const check = runDoctor({ selectedProfiles: [] });
  assert.equal(check.status, "ok");
  assert.match(check.detail, /1 current definitions/);
});

test("doctor includes a hidden explicitly selected model with its managed profile", () => {
  const check = runDoctor({ selectedProfiles: [hiddenDeepSeek.slug] });
  assert.equal(check.status, "ok");
  assert.match(check.detail, /2 current definitions/);
});
