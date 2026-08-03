import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function rootToml(contents) {
  const lines = contents.split("\n");
  const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
  return lines.slice(0, firstTable === -1 ? lines.length : firstTable).join("\n");
}

function rootValue(contents, key) {
  return rootToml(contents).match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m"))?.[1]?.trim();
}

function normalizeOnlyRootModel(contents) {
  const lines = contents.split("\n");
  const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
  const rootEnd = firstTable === -1 ? lines.length : firstTable;
  let modelLines = 0;
  for (let index = 0; index < rootEnd; index += 1) {
    if (/^\s*model\s*=/.test(lines[index])) {
      modelLines += 1;
      lines[index] = "model = <managed-model>";
    }
  }
  assert.equal(modelLines, 1, "config must contain exactly one root model row");
  return lines.join("\n");
}

function assertOnlyRootModelChanged(before, after, expectedModel) {
  assert.equal(rootValue(after, "model"), JSON.stringify(expectedModel));
  assert.equal(rootValue(after, "model_provider"), rootValue(before, "model_provider"));
  assert.equal(normalizeOnlyRootModel(after), normalizeOnlyRootModel(before));
}

function probe(target, providers, usageEvents = [], options = {}) {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "control-probe-"));
  writeFileSync(
    path.join(stateDir, "enabled-providers.json"),
    `${JSON.stringify({ version: 1, providers })}\n`,
    { mode: 0o600 },
  );
  if (usageEvents.length) {
    writeFileSync(
      path.join(stateDir, "usage-events.jsonl"),
      `${usageEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
      { mode: 0o600 },
    );
  }
  if (options.nativeModels) {
    writeFileSync(
      path.join(stateDir, "native-models.json"),
      `${JSON.stringify({ models: options.nativeModels })}\n`,
      { mode: 0o600 },
    );
  }
  if (options.selectedModel) {
    writeFileSync(
      path.join(stateDir, "config.toml"),
      `model = ${JSON.stringify(options.selectedModel)}\n`,
      { mode: 0o600 },
    );
  }
  if (options.mergedCatalog) {
    writeFileSync(
      path.join(stateDir, "merged-models.json"),
      `${JSON.stringify(options.mergedCatalog)}\n`,
      { mode: 0o600 },
    );
  }
  if (options.loginFree) {
    writeFileSync(
      path.join(stateDir, "config.toml"),
      `model = ${JSON.stringify(options.selectedModel || "deepseek/deepseek-v4-pro")}\nmodel_provider = "codex-router"\n`,
      { mode: 0o600 },
    );
    writeFileSync(
      path.join(stateDir, "codex-provider-mode.json"),
      `${JSON.stringify({
        version: 1,
        previousPresent: false,
        previousModelPresent: false,
      })}\n`,
      { mode: 0o600 },
    );
  }
  try {
    const output = execFileSync(process.execPath, [
      path.join(root, "src", "control.mjs"),
      "--probe",
      ...(options.picker ? ["--picker"] : []),
    ], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_HOME: stateDir,
        MODEL_ROUTER_TARGET: target,
        MODEL_ROUTER_STATE_DIR: stateDir,
      },
    });
    return JSON.parse(output);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

test("cursor probe does not expose selected models without credentials", () => {
  const slice = probe("cursor", ["deepseek"]);
  assert.equal(slice.target, "cursor");
  const deepseek = slice.models.filter((m) => m.provider === "deepseek");
  assert.ok(deepseek.length > 0 && deepseek.every((m) => !m.enabled));
});

test("codex probe exposes only privacy-safe recent usage events", () => {
  const event = {
    at: new Date().toISOString(),
    model: "grok-oauth/grok-4.5",
    provider: "grok-oauth",
    status: 200,
    durationMs: 1234,
    prompt: "must not escape the private event store",
  };
  const slice = probe("codex", ["grok-oauth"], [event]);
  assert.deepEqual(slice.usageEvents, [{
    at: event.at,
    model: event.model,
    provider: event.provider,
    status: event.status,
    durationMs: event.durationMs,
  }]);
  assert.equal("prompt" in slice.usageEvents[0], false);
  assert.equal("response" in slice.usageEvents[0], false);
});

test("picker probe exposes catalog freshness and restart state", () => {
  const slice = probe("codex", [], [], {
    picker: true,
    selectedModel: "gpt-5.6-sol",
    mergedCatalog: {
      catalogUpdatedAt: "2026-08-03T12:34:56.000Z",
      models: [],
    },
  });
  assert.equal(slice.catalogUpdatedAt, "2026-08-03T12:34:56.000Z");
  assert.equal(slice.restartRequired, true);
});

test("picker probe omits slow status and usage data while preserving its catalog", () => {
  const slice = probe("codex", ["opencode-go"], [{
    at: new Date().toISOString(),
    model: "opencode-go/kimi-k3",
    provider: "opencode-go",
    status: 200,
    durationMs: 100,
  }], {
    picker: true,
    selectedModel: "gpt-5.6-sol",
    nativeModels: [
      { slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol", visibility: "list" },
    ],
  });

  assert.equal(slice.target, "codex");
  assert.equal(slice.selectedModel, "gpt-5.6-sol");
  assert.equal(slice.models.some((model) => model.slug === "gpt-5.6-sol"), true);
  assert.equal(slice.models.some((model) => model.provider === "opencode-go"), true);
  assert.equal("active" in slice, false);
  assert.equal("usageEvents" in slice, false);
  assert.equal("loginFree" in slice, false);
  assert.equal("providers" in slice, false);
});

test("codex probe includes native GPT models and the configured default", () => {
  const slice = probe("codex", ["grok-oauth"], [], {
    selectedModel: "gpt-5.6-terra",
    nativeModels: [
      {
        slug: "gpt-5.6-terra",
        display_name: "GPT-5.6-Terra",
        visibility: "list",
      },
      {
        slug: "codex-auto-review",
        display_name: "Codex Auto Review",
        visibility: "hide",
      },
    ],
  });

  assert.equal(slice.selectedModel, "gpt-5.6-terra");
  assert.deepEqual(
    slice.models.find((model) => model.slug === "gpt-5.6-terra"),
    {
      slug: "gpt-5.6-terra",
      displayName: "GPT-5.6-Terra",
      provider: "openai",
      gatewayModel: "gpt-5.6-terra",
      enabled: true,
      native: true,
      pickerVisibility: "list",
      family: "GPT",
    },
  );
  assert.equal(slice.models.some((model) => model.slug === "codex-auto-review"), false);
  assert.equal(slice.loginFree, false);
  assert.equal(slice.loginFreeManaged, false);
});

test("codex probe keeps only the latest two native GPT generations", () => {
  const slice = probe("codex", ["opencode-go"], [], {
    nativeModels: [
      { slug: "gpt-5.6-sol", display_name: "5.6 Sol", visibility: "list" },
      { slug: "gpt-5.5", display_name: "5.5", visibility: "list" },
      { slug: "gpt-5.4", display_name: "5.4", visibility: "list" },
    ],
  });
  assert.deepEqual(
    slice.models.filter((model) => model.native).map((model) => model.slug),
    ["gpt-5.6-sol", "gpt-5.5"],
  );
});

test("codex probe exposes managed login-free mode without credential details", () => {
  const slice = probe("codex", ["deepseek"], [], { loginFree: true });
  assert.equal(slice.loginFree, true);
  assert.equal(slice.loginFreeManaged, true);
  assert.equal(JSON.stringify(slice).includes("previousModelProvider"), false);
});

function probeSet(target, providers, provider, desired) {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "control-set-"));
  writeFileSync(
    path.join(stateDir, "enabled-providers.json"),
    `${JSON.stringify({ version: 1, providers })}\n`,
    { mode: 0o600 },
  );
  try {
    const output = execFileSync(
      process.execPath,
      [path.join(root, "src", "control.mjs"), "--probe-set", provider, desired],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, MODEL_ROUTER_TARGET: target, MODEL_ROUTER_STATE_DIR: stateDir },
      },
    );
    return JSON.parse(output);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

test("toggle on adds a provider; toggle off removes it", () => {
  const added = probeSet("cursor", ["deepseek"], "grok-oauth", "on");
  assert.deepEqual(added.enabledProviders, ["deepseek", "grok-oauth"]);

  const removed = probeSet("cursor", ["grok-oauth", "deepseek"], "deepseek", "off");
  assert.deepEqual(removed.enabledProviders, ["grok-oauth"]);
});

test("toggle rejects an unknown provider", () => {
  assert.throws(() => probeSet("cursor", ["deepseek"], "not-a-provider", "on"));
});

test("login-free control selects a ready external model and restores Codex defaults", () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "control-login-free-"));
  writeFileSync(path.join(stateDir, "config.toml"), `model = "gpt-5.6-sol"\n`, {
    mode: 0o600,
  });
  writeFileSync(
    path.join(stateDir, "enabled-providers.json"),
    `${JSON.stringify({ version: 1, providers: ["deepseek"] })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(path.join(stateDir, "deepseek-api-key.secret"), "test-provider-key\n", {
    mode: 0o600,
  });
  writeFileSync(
    path.join(stateDir, "caller-secret"),
    "test-control-caller-capability-with-sufficient-length\n",
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(stateDir, "native-models.json"),
    `${JSON.stringify({
      models: [
        {
          slug: "gpt-5.6-sol",
          display_name: "GPT-5.6-Sol",
          visibility: "list",
          priority: 10,
        },
      ],
    })}\n`,
    { mode: 0o600 },
  );
  const runMode = (desired) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [path.join(root, "src", "control.mjs"), "auth-mode", desired],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            CODEX_HOME: stateDir,
            CODEX_BIN: process.execPath,
            MODEL_ROUTER_TARGET: "codex",
            MODEL_ROUTER_STATE_DIR: stateDir,
          },
        },
      ),
    );

  try {
    const enabled = runMode("on");
    assert.equal(enabled.login_free, true);
    assert.equal(enabled.model, "gpt-5.6-sol");
    assert.equal(enabled.model_provider, "codex-router");
    const catalog = JSON.parse(readFileSync(path.join(stateDir, "merged-models.json"), "utf8"));
    const aliasEntry = catalog.models.find((model) => model.slug === "gpt-5.6-sol");
    assert.match(aliasEntry.display_name, /DeepSeek/);
    assert.equal(aliasEntry.visibility, "list");
    assert.deepEqual(
      catalog.models
        .filter((model) => model.slug.startsWith("deepseek/"))
        .map((model) => [model.slug, model.visibility]),
      [
        ["deepseek/deepseek-v4-flash", "hide"],
        ["deepseek/deepseek-v4-pro", "list"],
      ],
    );
    const aliases = JSON.parse(readFileSync(path.join(stateDir, "native-aliases.json"), "utf8"));
    assert.deepEqual(aliases, {
      version: 1,
      aliases: { "gpt-5.6-sol": "deepseek/deepseek-v4-flash" },
    });

    const disabled = runMode("off");
    assert.equal(disabled.login_free, false);
    assert.equal(disabled.model, "gpt-5.6-sol");
    assert.equal(disabled.model_provider, "openai");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("login-free aliasing applies even when a ChatGPT credential is still stored", () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "control-login-free-auth-"));
  writeFileSync(path.join(stateDir, "config.toml"), `model = "gpt-5.6-sol"\n`, {
    mode: 0o600,
  });
  writeFileSync(
    path.join(stateDir, "enabled-providers.json"),
    `${JSON.stringify({ version: 1, providers: ["deepseek"] })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(path.join(stateDir, "deepseek-api-key.secret"), "test-provider-key\n", {
    mode: 0o600,
  });
  writeFileSync(
    path.join(stateDir, "caller-secret"),
    "test-control-caller-capability-with-sufficient-length\n",
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(stateDir, "native-models.json"),
    `${JSON.stringify({
      models: [
        { slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol", visibility: "list", priority: 10 },
      ],
    })}\n`,
    { mode: 0o600 },
  );
  try {
    const enabled = JSON.parse(
      execFileSync(
        process.execPath,
        [path.join(root, "src", "control.mjs"), "auth-mode", "on"],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            CODEX_HOME: stateDir,
            CODEX_BIN: "/usr/bin/true",
            MODEL_ROUTER_TARGET: "codex",
            MODEL_ROUTER_STATE_DIR: stateDir,
          },
        },
      ),
    );
    assert.equal(enabled.login_free, true);
    assert.equal(enabled.model, "gpt-5.6-sol");
    const aliases = JSON.parse(readFileSync(path.join(stateDir, "native-aliases.json"), "utf8"));
    assert.deepEqual(aliases.aliases, { "gpt-5.6-sol": "deepseek/deepseek-v4-flash" });
    const catalog = JSON.parse(readFileSync(path.join(stateDir, "merged-models.json"), "utf8"));
    assert.match(
      catalog.models.find((model) => model.slug === "gpt-5.6-sol").display_name,
      /DeepSeek/,
    );
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("model-set safely selects authenticated, native, and login-free models", () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "control-model-set-"));
  writeFileSync(path.join(stateDir, "config.toml"), `model = "gpt-5.6-sol"\n`, {
    mode: 0o600,
  });
  writeFileSync(
    path.join(stateDir, "enabled-providers.json"),
    `${JSON.stringify({ version: 1, providers: ["deepseek", "kimi-api"] })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(path.join(stateDir, "deepseek-api-key.secret"), "test-provider-key\n", {
    mode: 0o600,
  });
  writeFileSync(
    path.join(stateDir, "caller-secret"),
    "test-control-caller-capability-with-sufficient-length\n",
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(stateDir, "native-models.json"),
    `${JSON.stringify({
      models: [
        {
          slug: "gpt-5.6-sol",
          display_name: "GPT-5.6-Sol",
          visibility: "list",
          priority: 10,
        },
      ],
    })}\n`,
    { mode: 0o600 },
  );
  const environment = {
    ...process.env,
    CODEX_HOME: stateDir,
    CODEX_BIN: process.execPath,
    KIMI_CODE_HOME: path.join(stateDir, "kimi-code"),
    MODEL_ROUTER_TARGET: "codex",
    MODEL_ROUTER_STATE_DIR: stateDir,
  };
  delete environment.KIMI_API_KEY;
  delete environment.MOONSHOT_API_KEY;
  const runControl = (...commandArgs) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [path.join(root, "src", "control.mjs"), ...commandArgs],
        { cwd: root, encoding: "utf8", env: environment },
      ),
    );

  try {
    execFileSync(
      process.execPath,
      [path.join(root, "src", "config-manager.mjs"), "enable"],
      { cwd: root, encoding: "utf8", env: environment },
    );

    const authenticated = runControl("model-set", "deepseek/deepseek-v4-pro");
    assert.equal(authenticated.model, "deepseek/deepseek-v4-pro");
    assert.equal(authenticated.model_provider, "openai");
    assert.equal(authenticated.login_free, false);

    const native = runControl("model-set", "gpt-5.6-sol");
    assert.equal(native.model, "gpt-5.6-sol");
    assert.equal(native.model_provider, "openai");

    runControl("auth-mode", "on");
    const switched = runControl("model-set", "deepseek/deepseek-v4-flash");
    assert.equal(switched.model, "gpt-5.6-sol");
    assert.equal(switched.model_provider, "codex-router");
    assert.equal(switched.login_free, true);

    const overflow = runControl("model-set", "deepseek/deepseek-v4-pro");
    assert.equal(overflow.model, "deepseek/deepseek-v4-pro");

    assert.throws(
      () => runControl("model-set", "kimi-api/kimi-k3"),
      /authenticated/,
      "model-set must reject models from unauthenticated providers",
    );
    assert.throws(
      () => runControl("model-set", "gpt-5.6-sol"),
      /unavailable while login-free/,
      "model-set must reject native models in login-free mode",
    );
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("model catalog and selection preserve native state and support an explicit restart", () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "control-native-catalog-"));
  const configPath = path.join(stateDir, "config.toml");
  const credentialsPath = path.join(stateDir, "deepseek-api-key.secret");
  const authPath = path.join(stateDir, "auth.json");
  const unrelatedTomlPath = path.join(stateDir, "unrelated.toml");
  const skillsPath = path.join(stateDir, "skills.toml");
  const restartLog = path.join(stateDir, "restart.log");
  writeFileSync(
    configPath,
    `model = "gpt-5.6-sol"\nmodel_provider = "openai"\n\n[mcp_servers.local]\ncommand = "keep-me"\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(stateDir, "enabled-providers.json"),
    `${JSON.stringify({ version: 1, providers: ["kimi-api"] })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(credentialsPath, "test-provider-secret\n", { mode: 0o600 });
  writeFileSync(authPath, "{\"tokens\":\"must-stay-private\"}\n", { mode: 0o600 });
  writeFileSync(unrelatedTomlPath, "unrelated = \"keep-me\"\n", { mode: 0o600 });
  writeFileSync(skillsPath, "skill = \"keep-me\"\n", { mode: 0o600 });
  writeFileSync(
    path.join(stateDir, "caller-secret"),
    "test-control-caller-capability-with-sufficient-length\n",
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(stateDir, "native-models.json"),
    `${JSON.stringify({
      models: [{ slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol", visibility: "list" }],
    })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(stateDir, "merged-models.json"),
    `${JSON.stringify({
      catalogUpdatedAt: "2026-08-03T12:00:00.000Z",
      models: [
        { slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol", visibility: "list" },
        {
          slug: "deepseek/deepseek-v4-pro",
          display_name: "DeepSeek V4 Pro",
          visibility: "list",
        },
      ],
    })}\n`,
    { mode: 0o600 },
  );
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    CODEX_HOME: stateDir,
    CODEX_BIN: "/usr/bin/true",
    CODEX_ROUTER_STATE_DIR: stateDir,
    MODEL_ROUTER_TARGET: "codex",
    CODEX_ROUTER_TEST_RESTART_MARKER: restartLog,
  };
  const runControl = (...commandArgs) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [path.join(root, "src", "control.mjs"), ...commandArgs],
        { cwd: root, encoding: "utf8", env: environment },
      ),
    );

  try {
    execFileSync(
      process.execPath,
      [path.join(root, "src", "config-manager.mjs"), "enable"],
      { cwd: root, encoding: "utf8", env: environment },
    );
    const beforeConfig = readFileSync(configPath, "utf8");
    const beforeCredential = readFileSync(credentialsPath);
    const beforeSkill = readFileSync(skillsPath);
    const beforeCredentialMode = statSync(credentialsPath).mode;
    const beforeAuth = readFileSync(authPath);
    const beforeAuthMode = statSync(authPath).mode;
    const beforeUnrelatedToml = readFileSync(unrelatedTomlPath);
    const beforeUnrelatedTomlMode = statSync(unrelatedTomlPath).mode;
    const catalog = runControl("model-catalog", "--json");
    assert.equal(catalog.catalogUpdatedAt, "2026-08-03T12:00:00.000Z");
    assert.equal(catalog.restartRequired, true);
    assert.deepEqual(
      catalog.models.map((model) => model.slug),
      ["gpt-5.6-sol", "deepseek/deepseek-v4-pro"],
    );

    const saved = runControl("model-set", "deepseek/deepseek-v4-pro", "--restart=false");
    assert.equal(saved.selectedModel, "deepseek/deepseek-v4-pro");
    assert.equal(saved.restartRequired, true);
    assert.equal(saved.restarted, false);
    assertOnlyRootModelChanged(
      beforeConfig,
      readFileSync(configPath, "utf8"),
      "deepseek/deepseek-v4-pro",
    );
    assert.deepEqual(readFileSync(credentialsPath), beforeCredential);
    assert.deepEqual(readFileSync(skillsPath), beforeSkill);
    assert.equal(statSync(credentialsPath).mode, beforeCredentialMode);
    assert.deepEqual(readFileSync(authPath), beforeAuth);
    assert.equal(statSync(authPath).mode, beforeAuthMode);
    assert.deepEqual(readFileSync(unrelatedTomlPath), beforeUnrelatedToml);
    assert.equal(statSync(unrelatedTomlPath).mode, beforeUnrelatedTomlMode);
    assert.equal(
      JSON.parse(readFileSync(path.join(stateDir, "enabled-providers.json"), "utf8"))
        .providers.includes("deepseek"),
      true,
    );
    assert.equal(
      readdirSync(stateDir).some((name) => name.startsWith("config.toml.tmp.")),
      false,
    );

    const beforeNativeConfig = readFileSync(configPath, "utf8");
    const restarted = runControl("model-set", "gpt-5.6-sol", "--restart=true");
    assert.equal(restarted.selectedModel, "gpt-5.6-sol");
    assert.equal(restarted.restarted, true);
    assert.equal(restarted.restartRequired, false);
    assertOnlyRootModelChanged(
      beforeNativeConfig,
      readFileSync(configPath, "utf8"),
      "gpt-5.6-sol",
    );
    assert.equal(readFileSync(restartLog, "utf8"), "called\n");

    const directRestart = runControl("codex-restart");
    assert.deepEqual(directRestart, { restarted: true, restartRequired: false });
    assert.equal(readFileSync(restartLog, "utf8"), "called\ncalled\n");

    assert.throws(
      () => runControl("model-set", "gpt-5.6-sol", "--restart"),
      /Usage: control model-set/,
      "bare --restart must be rejected",
    );
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("external model selection and explicit profile toggles manage subagent state", () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "control-agent-profile-"));
  const agentsDir = path.join(stateDir, "agents");
  const selectionPath = path.join(stateDir, "selected-external-agents.json");
  writeFileSync(path.join(stateDir, "config.toml"), `model = "gpt-5.6-sol"\n`, { mode: 0o600 });
  writeFileSync(
    path.join(stateDir, "enabled-providers.json"),
    `${JSON.stringify({ version: 1, providers: ["deepseek"] })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(path.join(stateDir, "deepseek-api-key.secret"), "test-provider-secret\n", { mode: 0o600 });
  writeFileSync(path.join(stateDir, "caller-secret"), "test-control-caller-capability-with-sufficient-length\n", { mode: 0o600 });
  writeFileSync(path.join(stateDir, "native-models.json"), JSON.stringify({
    models: [{ slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol", visibility: "list" }],
  }), { mode: 0o600 });
  const environment = {
    ...process.env,
    CODEX_HOME: stateDir,
    CODEX_BIN: "/usr/bin/true",
    MODEL_ROUTER_TARGET: "codex",
    MODEL_ROUTER_STATE_DIR: stateDir,
    MODEL_ROUTER_EXTERNAL_AGENT_SELECTION_PATH: selectionPath,
    MODEL_ROUTER_VERIFIED_EXTERNAL_AGENT_RECORD_PATH: path.join(stateDir, "verified-external-agents.json"),
  };
  const runControl = (...commandArgs) => JSON.parse(execFileSync(
    process.execPath,
    [path.join(root, "src", "control.mjs"), ...commandArgs],
    { cwd: root, encoding: "utf8", env: environment },
  ));

  try {
    execFileSync(process.execPath, [path.join(root, "src", "config-manager.mjs"), "enable"], {
      cwd: root,
      encoding: "utf8",
      env: environment,
    });
    const selected = runControl("model-set", "deepseek/deepseek-v4-pro", "--restart=false");
    assert.equal(selected.subagentProfile.selected, true);
    assert.deepEqual(JSON.parse(readFileSync(selectionPath, "utf8")).profiles, ["deepseek/deepseek-v4-pro"]);
    assert.equal(
      readFileSync(path.join(agentsDir, "router-model-deepseek-deepseek-v4-pro.toml"), "utf8")
        .includes('model = "deepseek/deepseek-v4-pro"'),
      true,
    );

    const disabled = runControl("agent-profile-set", "deepseek/deepseek-v4-pro", "off");
    assert.equal(disabled.selected, false);
    assert.deepEqual(JSON.parse(readFileSync(selectionPath, "utf8")).profiles, []);
    const enabled = runControl("agent-profile-set", "deepseek/deepseek-v4-pro", "on");
    assert.equal(enabled.selected, true);
    assert.deepEqual(enabled.selectedProfiles, ["deepseek/deepseek-v4-pro"]);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("failed external profile update restores disabled-provider selection and model config", () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "control-catalog-rollback-"));
  const configPath = path.join(stateDir, "config.toml");
  const providersPath = path.join(stateDir, "enabled-providers.json");
  const agentsDir = path.join(stateDir, "agents");
  const externalSelectionPath = path.join(stateDir, "selected-external-agents.json");
  writeFileSync(
    configPath,
    `model = "gpt-5.6-sol"\nmodel_provider = "openai"\nroot_keep = "keep-me"\n\n[mcp_servers.local]\ncommand = "keep-me"\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    providersPath,
    `${JSON.stringify({ version: 1, providers: ["kimi-api"] })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(path.join(stateDir, "deepseek-api-key.secret"), "test-provider-secret\n", {
    mode: 0o600,
  });
  writeFileSync(path.join(stateDir, "caller-secret"), "test-control-caller-capability-with-sufficient-length\n", {
    mode: 0o600,
  });
  writeFileSync(path.join(stateDir, "native-models.json"), JSON.stringify({
    models: [{ slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol", visibility: "list" }],
  }), {
    mode: 0o600,
  });
  writeFileSync(externalSelectionPath, "not-json\n", { mode: 0o600 });
  mkdirSync(agentsDir, { mode: 0o700 });
  const existingManagedAgent = path.join(agentsDir, "router-model-deepseek-deepseek-v4-flash.toml");
  writeFileSync(existingManagedAgent, "# Managed by Codex Router. old definition\n", { mode: 0o600 });
  const userOwnedAgent = path.join(agentsDir, "router-model-deepseek-deepseek-v4-pro.toml");
  mkdirSync(userOwnedAgent, { mode: 0o700 });
  const environment = {
    ...process.env,
    CODEX_HOME: stateDir,
    CODEX_BIN: "/usr/bin/true",
    CODEX_ROUTER_STATE_DIR: stateDir,
    MODEL_ROUTER_TARGET: "codex",
    MODEL_ROUTER_EXTERNAL_AGENT_SELECTION_PATH: externalSelectionPath,
  };
  const originalConfig = readFileSync(configPath);
  const originalProviders = readFileSync(providersPath);
  try {
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [path.join(root, "src", "control.mjs"), "model-set", "deepseek/deepseek-v4-pro"],
          { cwd: root, encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "pipe"] },
        ),
      /Invalid external agent selection/i,
    );
    assert.deepEqual(readFileSync(configPath), originalConfig);
    assertOnlyRootModelChanged(
      originalConfig.toString("utf8"),
      readFileSync(configPath, "utf8"),
      "gpt-5.6-sol",
    );
    assert.deepEqual(readFileSync(providersPath), originalProviders);
    assert.equal(readFileSync(existingManagedAgent, "utf8"), "# Managed by Codex Router. old definition\n");
    if (process.platform !== "win32") {
      assert.equal(statSync(existingManagedAgent).mode & 0o777, 0o600);
    }
    assert.equal(statSync(userOwnedAgent).isDirectory(), true);
    assert.equal(readdirSync(agentsDir).some((name) => name.includes(".tmp.")), false);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("aggregate overview covers every target", () => {
  const output = execFileSync(process.execPath, [path.join(root, "src", "control.mjs"), "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  const overview = JSON.parse(output);
  assert.deepEqual(Object.keys(overview.targets).sort(), ["codex", "cursor"]);
});
