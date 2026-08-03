import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { privateFileIsProtected } from "../src/file-security.mjs";
import {
  removeExternalAgentRegistrationBlock,
  syncExternalAgentRegistrations,
} from "../src/codex-agent-registration.mjs";

test("external agent registrations preserve user config and use relative protected files", () => {
  const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-agent-registration-"));
  const configPath = path.join(codexHome, "config.toml");
  const agentsDir = path.join(codexHome, "agents");
  const profilePath = path.join(agentsDir, "router-model-opencode-go-qwen3-8-max.toml");
  writeFileSync(configPath, '[features]\nmulti_agent = true\n\n[agents.user_agent]\ndescription = "Keep me"\nconfig_file = "agents/user.toml"\n', { mode: 0o600 });

  try {
    const result = syncExternalAgentRegistrations([{
      agentName: "router_opencode_go_qwen3_8_max",
      fileName: path.basename(profilePath),
      path: profilePath,
      displayName: "Qwen3.8 MAX (OpenCode Go)",
      managed: true,
    }], { configPath, codexHome });
    assert.deepEqual(result.registered, ["router_opencode_go_qwen3_8_max"]);
    const contents = readFileSync(configPath, "utf8");
    assert.match(contents, /\[agents\.user_agent\]/);
    assert.match(contents, /\[agents\.router_opencode_go_qwen3_8_max\]/);
    assert.match(contents, /config_file = "agents\/router-model-opencode-go-qwen3-8-max\.toml"/);
    assert.equal(privateFileIsProtected(configPath), true);
    assert.doesNotMatch(removeExternalAgentRegistrationBlock(contents), /agents\.router_opencode/);
    assert.match(removeExternalAgentRegistrationBlock(contents), /\[agents\.user_agent\]/);
  } finally {
    rmSync(codexHome, { recursive: true, force: true });
  }
});

test("external agent registration never replaces a user-owned role", () => {
  const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-agent-collision-"));
  const configPath = path.join(codexHome, "config.toml");
  writeFileSync(configPath, '[agents.router_collision]\ndescription = "User owned"\nconfig_file = "agents/user.toml"\n', { mode: 0o600 });
  try {
    const result = syncExternalAgentRegistrations([{
      agentName: "router_collision",
      fileName: "router-model-collision.toml",
      path: path.join(codexHome, "agents", "router-model-collision.toml"),
      displayName: "Collision",
      managed: true,
    }], { configPath, codexHome });
    assert.deepEqual(result.registered, []);
    assert.deepEqual(result.skipped, ["router_collision"]);
    assert.equal(readFileSync(configPath, "utf8").match(/\[agents\.router_collision\]/g).length, 1);
  } finally {
    rmSync(codexHome, { recursive: true, force: true });
  }
});
