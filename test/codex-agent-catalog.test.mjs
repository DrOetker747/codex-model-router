import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { protectPrivateFile } from "../src/file-security.mjs";

import {
  MAX_SELECTED_EXTERNAL_PROFILES,
  preserveNativeAgentProfiles,
  readSelectedExternalAgentProfiles,
  readVerifiedExternalAgentProfiles,
  rebuildExternalSubagentProfiles,
  routedAgentDefinition,
  routedCodexAgentStatus,
  selectedExternalSubagentModels,
  syncRoutedCodexAgents,
  writeSelectedExternalAgentProfiles,
} from "../src/codex-agent-catalog.mjs";

const kimi = {
  slug: "kimi-oauth/k3",
  displayName: "Kimi K3 (OAuth)",
};

const qwen = {
  slug: "qwen-plan/qwen3.7-max",
  provider: "qwen-plan",
  listed: true,
  display_name: "Qwen3.7 Max (Plan)",
  displayName: "Qwen3.7 Max (Plan)",
  visibility: "list",
  priority: 12,
  input_modalities: ["text"],
  inputModalities: ["text"],
  context_window: 262144,
  contextWindow: 262144,
  auto_compact_token_limit: 235000,
  autoCompact: 235000,
  default_reasoning_level: "high",
  defaultEffort: "high",
  supported_reasoning_levels: [{ effort: "high", description: "Adaptive reasoning" }],
  reasoningLevels: [{ effort: "high", description: "Adaptive reasoning" }],
};

const hiddenDeepSeek = {
  ...qwen,
  slug: "deepseek/deepseek-v4-pro",
  provider: "deepseek",
  display_name: "DeepSeek V4 Pro (API)",
  displayName: "DeepSeek V4 Pro (API)",
  visibility: "hide",
  priority: 7,
};

const incompatible = {
  ...hiddenDeepSeek,
  slug: "deepseek/deepseek-image-only",
  input_modalities: ["image"],
  inputModalities: ["image"],
};

test("routed agent definitions select the router provider and exact model slug", () => {
  const definition = routedAgentDefinition(kimi);
  assert.equal(definition.agentName, "router_kimi_oauth_k3");
  assert.equal(definition.fileName, "router-model-kimi-oauth-k3.toml");
  assert.match(definition.contents, /^# Managed by Codex Router\./);
  assert.match(definition.contents, /model_provider = "codex-router"/);
  assert.match(definition.contents, /model = "kimi-oauth\/k3"/);
  assert.doesNotMatch(definition.contents, /^name\s*=/m);
  assert.doesNotMatch(definition.contents, /^description\s*=/m);
});

test("agent sync writes one private definition for every routed model", () => {
  const agentsDir = mkdtempSync(path.join(os.tmpdir(), "codex-router-agents-"));
  const written = syncRoutedCodexAgents(
    [kimi, { slug: "grok-oauth/grok-4.5", displayName: "Grok 4.5 (OAuth)" }],
    agentsDir,
  );

  assert.deepEqual(
    written.map(({ model, agent }) => ({ model, agent })),
    [
      { model: "kimi-oauth/k3", agent: "router_kimi_oauth_k3" },
      { model: "grok-oauth/grok-4.5", agent: "router_grok_oauth_grok_4_5" },
    ],
  );
  const kimiFile = path.join(agentsDir, "router-model-kimi-oauth-k3.toml");
  assert.match(readFileSync(kimiFile, "utf8"), /model = "kimi-oauth\/k3"/);
  assert.deepEqual(routedCodexAgentStatus([kimi], agentsDir), {
    expected: 1,
    current: 1,
    missing: [],
    stale: [],
    unprotected: [],
    ok: true,
  });
});

test("agent status reports definitions that have not been installed", () => {
  const agentsDir = mkdtempSync(path.join(os.tmpdir(), "codex-router-agents-"));
  assert.deepEqual(routedCodexAgentStatus([kimi], agentsDir), {
    expected: 1,
    current: 0,
    missing: ["kimi-oauth/k3"],
    stale: [],
    unprotected: [],
    ok: false,
  });
});

test("agent definitions reject non-routed model slugs", () => {
  assert.throws(() => routedAgentDefinition({ slug: "gpt-5.6-sol" }), /invalid model slug/);
});

test("agent sync does not replace a user-owned matching file", () => {
  const agentsDir = mkdtempSync(path.join(os.tmpdir(), "codex-router-user-agent-"));
  const target = path.join(agentsDir, "router-model-kimi-oauth-k3.toml");
  writeFileSync(target, "name = \"user-owned\"\n", { mode: 0o600 });
  try {
    assert.throws(
      () => syncRoutedCodexAgents([kimi], agentsDir),
      /user-owned agent/,
    );
    assert.equal(readFileSync(target, "utf8"), "name = \"user-owned\"\n");
  } finally {
    rmSync(agentsDir, { recursive: true, force: true });
  }
});

test("rebuild preserves native profiles, creates visible Qwen, and removes only stale managed files", () => {
  const agentsDir = mkdtempSync(path.join(os.tmpdir(), "codex-router-profile-rebuild-"));
  const nativeSol = path.join(agentsDir, "sol.toml");
  const nativeLuna = path.join(agentsDir, "luna.toml");
  const stale = path.join(agentsDir, "router-model-old-model.toml");
  const userOwned = path.join(agentsDir, "router-model-user-file.toml");
  writeFileSync(nativeSol, 'name = "Sol"\nrole = "native-sol"\n', { mode: 0o600 });
  writeFileSync(nativeLuna, 'name = "Luna"\nrole = "native-luna"\n', { mode: 0o600 });
  writeFileSync(stale, "# Managed by Codex Router. old\n", { mode: 0o600 });
  writeFileSync(userOwned, 'name = "user-owned"\n', { mode: 0o600 });
  const nativeCatalog = {
    models: [
      { slug: "gpt-5.6-sol", display_name: "Sol", role: "native-sol" },
      { slug: "gpt-5.6-luna", display_name: "Luna", role: "native-luna" },
    ],
  };

  try {
    const result = rebuildExternalSubagentProfiles({
      mergedCatalog: {
        catalogUpdatedAt: "2026-08-03T12:00:00.000Z",
        models: [qwen, hiddenDeepSeek, incompatible, ...nativeCatalog.models],
        nativeProfiles: preserveNativeAgentProfiles(nativeCatalog),
      },
      selectedProfiles: [],
      agentsDir,
    });

    assert.deepEqual(result.nativeProfiles.map((profile) => profile.slug), [
      "gpt-5.6-sol",
      "gpt-5.6-luna",
    ]);
    assert.deepEqual(result.externalProfiles.map((profile) => profile.slug), [
      "qwen-plan/qwen3.7-max",
    ]);
    assert.equal(result.externalProfiles[0].status, "catalog-only");
    assert.match(readFileSync(path.join(agentsDir, "router-model-qwen-plan-qwen3-7-max.toml"), "utf8"), /model_provider = "codex-router"/);
    assert.equal(existsSync(path.join(agentsDir, "router-model-deepseek-deepseek-v4-pro.toml")), false);
    assert.equal(existsSync(path.join(agentsDir, "router-model-deepseek-deepseek-image-only.toml")), false);
    assert.equal(existsSync(stale), false);
    assert.equal(readFileSync(nativeSol, "utf8"), 'name = "Sol"\nrole = "native-sol"\n');
    assert.equal(readFileSync(nativeLuna, "utf8"), 'name = "Luna"\nrole = "native-luna"\n');
    assert.equal(readFileSync(userOwned, "utf8"), 'name = "user-owned"\n');
  } finally {
    rmSync(agentsDir, { recursive: true, force: true });
  }
});

test("hidden external profile is created only after canonical explicit selection", () => {
  const agentsDir = mkdtempSync(path.join(os.tmpdir(), "codex-router-profile-select-"));
  try {
    const result = rebuildExternalSubagentProfiles({
      mergedCatalog: { models: [qwen, hiddenDeepSeek] },
      selectedProfiles: [hiddenDeepSeek.slug],
      agentsDir,
    });
    assert.deepEqual(result.externalProfiles.map((profile) => profile.slug), [
      "deepseek/deepseek-v4-pro",
      "qwen-plan/qwen3.7-max",
    ]);
    assert.equal(result.externalProfiles[0].status, "catalog-only");
    assert.match(readFileSync(path.join(agentsDir, "router-model-deepseek-deepseek-v4-pro.toml"), "utf8"), /model = "deepseek\/deepseek-v4-pro"/);
  } finally {
    rmSync(agentsDir, { recursive: true, force: true });
  }
});

test("selected external profile state is atomic, canonical, and bounded", () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "codex-router-profile-state-"));
  const statePath = path.join(stateDir, "selected-external-agents.json");
  try {
    assert.deepEqual(
      writeSelectedExternalAgentProfiles([
        "deepseek/deepseek-v4-pro",
        "qwen-plan/qwen3.7-max",
        "deepseek/deepseek-v4-pro",
      ], statePath),
      ["deepseek/deepseek-v4-pro", "qwen-plan/qwen3.7-max"],
    );
    assert.deepEqual(readSelectedExternalAgentProfiles(statePath), [
      "deepseek/deepseek-v4-pro",
      "qwen-plan/qwen3.7-max",
    ]);
    assert.equal(readdirSync(stateDir).some((name) => name.includes(".tmp.")), false);
    assert.throws(() => writeSelectedExternalAgentProfiles(["DeepSeek V4 Pro"], statePath), /canonical slug/);
    assert.throws(
      () => writeSelectedExternalAgentProfiles(
        Array.from({ length: MAX_SELECTED_EXTERNAL_PROFILES + 1 }, (_, index) => `provider/model-${index}`),
        statePath,
      ),
      /maximum|bounded/i,
    );
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("catalog tool-call metadata stays catalog-only and protected verification is explicit", () => {
  const agentsDir = mkdtempSync(path.join(os.tmpdir(), "codex-router-verification-"));
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "codex-router-verification-state-"));
  const verificationPath = path.join(stateDir, "verified-external-agents.json");
  const model = { ...qwen, capabilities: ["tool-calls"], supportsToolCalls: true };
  try {
    assert.deepEqual([...readVerifiedExternalAgentProfiles(verificationPath)], []);
    const catalogOnly = rebuildExternalSubagentProfiles({
      mergedCatalog: { models: [model] },
      selectedProfiles: [],
      agentsDir,
      verifiedProfiles: [],
    });
    assert.equal(catalogOnly.externalProfiles[0].status, "catalog-only");
    writeFileSync(
      verificationPath,
      `${JSON.stringify({
        version: 1,
        records: [{
          slug: model.slug,
          verified: true,
          method: "meaningful-text-tool-call",
          recordId: "test-record",
        }],
      })}\n`,
      { mode: 0o600 },
    );
    protectPrivateFile(verificationPath);
    const verified = readVerifiedExternalAgentProfiles(verificationPath);
    assert.deepEqual([...verified], [model.slug]);
    const rebuilt = rebuildExternalSubagentProfiles({
      mergedCatalog: { models: [model] },
      selectedProfiles: [],
      agentsDir,
      verifiedProfiles: verified,
    });
    assert.equal(rebuilt.externalProfiles[0].status, "verified");
  } finally {
    rmSync(agentsDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("bounded external model helper matches rebuild visibility and explicit selection", () => {
  const mergedCatalog = { models: [qwen, hiddenDeepSeek] };
  assert.deepEqual(
    selectedExternalSubagentModels({ mergedCatalog, selectedProfiles: [] }).map((model) => model.slug),
    [qwen.slug],
  );
  assert.deepEqual(
    selectedExternalSubagentModels({
      mergedCatalog,
      selectedProfiles: [hiddenDeepSeek.slug],
    }).map((model) => model.slug),
    [hiddenDeepSeek.slug, qwen.slug],
  );
});
