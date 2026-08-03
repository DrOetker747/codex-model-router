import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  routedAgentDefinition,
  routedCodexAgentStatus,
  syncRoutedCodexAgents,
} from "../src/codex-agent-catalog.mjs";

const kimi = {
  slug: "kimi-oauth/k3",
  displayName: "Kimi K3 (OAuth)",
};

test("routed agent definitions select the router provider and exact model slug", () => {
  const definition = routedAgentDefinition(kimi);
  assert.equal(definition.agentName, "router_kimi_oauth_k3");
  assert.equal(definition.fileName, "router-model-kimi-oauth-k3.toml");
  assert.match(definition.contents, /^# Managed by Codex Router\./);
  assert.match(definition.contents, /model_provider = "codex-router"/);
  assert.match(definition.contents, /model = "kimi-oauth\/k3"/);
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
  assert.match(readFileSync(kimiFile, "utf8"), /name = "router_kimi_oauth_k3"/);
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
