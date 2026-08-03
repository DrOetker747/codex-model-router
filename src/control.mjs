import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { protectPrivateFile } from "./file-security.mjs";
import {
  CONFIG_PATH,
  CODEX_AGENTS_DIR,
  MERGED_CATALOG_PATH,
  NATIVE_ALIAS_PATH,
  NATIVE_CATALOG_PATH,
  PROVIDER_SELECTION_PATH,
} from "./paths.mjs";

// Cross-target control plane for a tray/UI (e.g. the planned pane fork). It
// reads which registry models are enabled per target and toggles them. Toggling
// only rewrites each target's provider selection; making it live is a separate
// explicit `apply`, so a toggle never silently restarts a running target.

const TARGETS = ["codex", "cursor"];
const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SELF), "..");
const args = process.argv.slice(2);

function targetIsActive(target) {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "src", "service.mjs"), "status"], {
    env: { ...process.env, MODEL_ROUTER_TARGET: target },
    encoding: "utf8",
  });
  try {
    const status = JSON.parse(result.stdout);
    return Boolean(status.installed || status.loaded);
  } catch {
    return false;
  }
}

function optionValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function configuredDefaultModel(configPath) {
  if (!existsSync(configPath)) return undefined;
  const config = readFileSync(configPath, "utf8");
  const firstTable = config.search(/^\s*\[/m);
  const root = firstTable === -1 ? config : config.slice(0, firstTable);
  return root.match(/^\s*model\s*=\s*["']([^"']+)["']/m)?.[1];
}

function snapshotFile(filePath) {
  if (!existsSync(filePath)) return { exists: false };
  return {
    exists: true,
    contents: readFileSync(filePath),
    mode: statSync(filePath).mode & 0o777,
  };
}

function restoreFile(filePath, snapshot) {
  if (!snapshot.exists) {
    if (existsSync(filePath)) unlinkSync(filePath);
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp.rollback.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(temporary, snapshot.contents, { mode: snapshot.mode });
    protectPrivateFile(temporary);
    renameSync(temporary, filePath);
    protectPrivateFile(filePath);
    chmodSync(filePath, snapshot.mode);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

const managedAgentName = /^router-model-[a-z0-9-]+\.toml$/;
const managedAgentMarker = "# Managed by Codex Router.";

function isManagedAgent(snapshot) {
  return snapshot.exists && snapshot.contents.toString("utf8").startsWith(managedAgentMarker);
}

function snapshotManagedAgents() {
  const snapshots = new Map();
  if (!existsSync(CODEX_AGENTS_DIR)) return snapshots;
  for (const entry of readdirSync(CODEX_AGENTS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !managedAgentName.test(entry.name)) continue;
    const target = path.join(CODEX_AGENTS_DIR, entry.name);
    const snapshot = snapshotFile(target);
    if (isManagedAgent(snapshot)) snapshots.set(entry.name, snapshot);
  }
  return snapshots;
}

function restoreManagedAgents(original) {
  if (existsSync(CODEX_AGENTS_DIR)) {
    for (const entry of readdirSync(CODEX_AGENTS_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !managedAgentName.test(entry.name)) continue;
      const target = path.join(CODEX_AGENTS_DIR, entry.name);
      const current = snapshotFile(target);
      if (isManagedAgent(current) && !original.has(entry.name)) unlinkSync(target);
    }
  }
  for (const [name, snapshot] of original) {
    restoreFile(path.join(CODEX_AGENTS_DIR, name), snapshot);
  }
}

function readMergedCatalog() {
  if (!existsSync(MERGED_CATALOG_PATH)) {
    throw new Error(`Codex model catalog is missing at ${MERGED_CATALOG_PATH}.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(MERGED_CATALOG_PATH, "utf8"));
  } catch (error) {
    throw new Error(
      `Codex model catalog is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.models)) {
    throw new Error("Codex model catalog is invalid: models must be an array.");
  }
  return parsed;
}

function modelCatalogSnapshot() {
  const catalog = readMergedCatalog();
  return {
    models: catalog.models,
    catalogUpdatedAt:
      typeof catalog.catalogUpdatedAt === "string" ? catalog.catalogUpdatedAt : null,
    selectedModel: configuredDefaultModel(CONFIG_PATH) || null,
    restartRequired: true,
  };
}

function codexConfigSnapshot() {
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "src", "config-manager.mjs"), "status"],
    { env: { ...process.env, MODEL_ROUTER_TARGET: "codex" }, encoding: "utf8" },
  );
  if (result.status !== 0) return undefined;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
}

function nativeCodexModels(catalogPath) {
  if (!existsSync(catalogPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(catalogPath, "utf8"));
    const listed = (Array.isArray(parsed.models) ? parsed.models : [])
      .filter((model) => model.visibility === "list" && typeof model.slug === "string");
    const versions = [...new Set(
      listed
        .map((model) => String(model.slug).match(/^gpt-(\d+)\.(\d+)(?:-|$)/))
        .filter(Boolean)
        .map((match) => `${match[1]}.${match[2]}`),
    )]
      .sort((left, right) => {
        const [leftMajor, leftMinor] = left.split(".").map(Number);
        const [rightMajor, rightMinor] = right.split(".").map(Number);
        return rightMajor - leftMajor || rightMinor - leftMinor;
      })
      .slice(0, 2);
    const currentVersions = new Set(versions);
    return listed
      .filter((model) => {
        const match = String(model.slug).match(/^gpt-(\d+)\.(\d+)(?:-|$)/);
        return !match || currentVersions.has(`${match[1]}.${match[2]}`);
      })
      .map((model) => ({
        slug: model.slug,
        displayName: model.display_name || model.slug,
        provider: "openai",
        gatewayModel: model.slug,
        enabled: true,
        native: true,
        pickerVisibility: "list",
        family: modelFamily(model.slug, model.display_name || model.slug),
      }));
  } catch {
    return [];
  }
}

function modelFamily(slug, displayName = "") {
  const value = `${slug} ${displayName}`.toLowerCase();
  const families = [
    ["deepseek", "DeepSeek"],
    ["minimax", "MiniMax"],
    ["big-pickle", "Free"],
    ["qwen", "Qwen"],
    ["kimi", "Kimi"],
    ["grok", "Grok"],
    ["mimo", "MiMo"],
    ["glm", "GLM"],
    ["hy", "HY"],
    ["gpt", "GPT"],
  ];
  return families.find(([needle]) => value.includes(needle))?.[1] || "Other";
}

// --- per-target probes (run with MODEL_ROUTER_TARGET set) -------------------

async function emitProbe() {
  const {
    CONFIG_PATH,
    NATIVE_CATALOG_PATH,
    TARGET,
    PROVIDER_SELECTION_PATH,
  } = await import("./paths.mjs");
  const { configuredProviderIds, readProviderSelection } = await import("./provider-selection.mjs");
  const { LISTED_MODELS, PROVIDERS } = await import("./model-registry.mjs");
  const { readNativeAliases } = await import("./native-alias.mjs");

  const pickerProbe = args.includes("--picker");
  const enabledProviders = readProviderSelection();
  const configuredProviders = new Set(configuredProviderIds());
  const usageEvents = TARGET === "codex" && !pickerProbe
    ? (await import("./usage-events.mjs")).recentUsageEvents()
    : [];
  const routedModels = LISTED_MODELS.map((model) => ({
    slug: model.slug,
    displayName: model.displayName,
    provider: model.provider,
    gatewayModel: model.gatewayModel,
    enabled: enabledProviders.includes(model.provider) && configuredProviders.has(model.provider),
    native: false,
    pickerVisibility: model.pickerVisibility || "list",
    family: modelFamily(model.slug, model.displayName),
  }));
  const models = TARGET === "codex"
    ? [...nativeCodexModels(NATIVE_CATALOG_PATH), ...routedModels]
    : routedModels;
  const selectedModel = TARGET === "codex" ? configuredDefaultModel(CONFIG_PATH) : undefined;
  const codexConfig = TARGET === "codex" && !pickerProbe ? codexConfigSnapshot() : undefined;

  process.stdout.write(
    JSON.stringify({
      target: TARGET,
      configured: existsSync(PROVIDER_SELECTION_PATH),
      ...(!pickerProbe ? { active: targetIsActive(TARGET) } : {}),
      enabledProviders,
      ...(!pickerProbe
        ? {
            providers: [...PROVIDERS.values()].map((provider) => ({
              id: provider.id,
              displayName: provider.displayName,
              kind: provider.kind,
            })),
          }
        : {}),
      models,
      ...(selectedModel ? { selectedModel } : {}),
      ...(codexConfig
        ? {
            loginFree: Boolean(codexConfig.login_free),
            loginFreeManaged: Boolean(codexConfig.login_free_managed),
          }
        : {}),
      ...(TARGET === "codex"
        ? {
            ...(!pickerProbe ? { usageEvents } : {}),
            nativeAliases: readNativeAliases(),
          }
        : {}),
    }),
  );
}

async function emitProbeSet(provider, desired) {
  const { TARGET } = await import("./paths.mjs");
  const { readProviderSelection, writeProviderSelection } = await import("./provider-selection.mjs");
  const { PROVIDERS } = await import("./model-registry.mjs");
  if (!PROVIDERS.has(provider)) throw new Error(`Unknown provider: ${provider}`);
  if (desired !== "on" && desired !== "off") throw new Error("state must be on or off");

  const current = readProviderSelection();
  const next =
    desired === "on"
      ? current.includes(provider)
        ? current
        : [...current, provider]
      : current.filter((id) => id !== provider);
  writeProviderSelection(next);
  process.stdout.write(JSON.stringify({ target: TARGET, enabledProviders: next }));
}

// --- aggregate over all targets --------------------------------------------

function probeTargets() {
  const targets = {};
  for (const target of TARGETS) {
    const result = spawnSync(process.execPath, [SELF, "--probe"], {
      env: { ...process.env, MODEL_ROUTER_TARGET: target },
      encoding: "utf8",
    });
    try {
      targets[target] = result.status === 0 ? JSON.parse(result.stdout) : { target, error: (result.stderr || "").trim() || "probe failed" };
    } catch {
      targets[target] = { target, error: "probe returned invalid JSON" };
    }
  }
  return targets;
}

function printOverview(asJson) {
  const targets = probeTargets();
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ targets }, null, 2)}\n`);
    return;
  }
  for (const target of TARGETS) {
    const slice = targets[target];
    if (slice.error) {
      process.stdout.write(`\n${target}: ${slice.error}\n`);
      continue;
    }
    process.stdout.write(`\n${target}${slice.configured ? "" : " (not set up)"}:\n`);
    for (const model of slice.models) {
      const mark = model.enabled ? "x" : " ";
      process.stdout.write(`  [${mark}] ${model.displayName}\n`);
    }
  }
}

function runSet(provider, desired) {
  const requested = optionValue("--targets");
  const selected = requested ? requested.split(",").map((value) => value.trim()) : TARGETS;
  for (const target of selected) {
    if (!TARGETS.includes(target)) throw new Error(`Unknown target: ${target}`);
    const result = spawnSync(process.execPath, [SELF, "--probe-set", provider, desired], {
      env: { ...process.env, MODEL_ROUTER_TARGET: target },
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(`${target}: ${(result.stderr || "").trim() || "toggle failed"}`);
    }
  }
  process.stderr.write(
    `Set ${provider} ${desired} for: ${selected.join(", ")}. Run \`bin/control apply\` to make it live.\n`,
  );
  printOverview(args.includes("--json"));
}

function refreshActiveTarget(target) {
  const command =
    target === "codex"
      ? [process.execPath, [path.join(REPO_ROOT, "src", "catalog.mjs")]]
      : undefined;
  if (!command) return;
  const result = spawnSync(command[0], command[1], {
    env: { ...process.env, MODEL_ROUTER_TARGET: target },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`${target}: refresh failed`);
}

// Active routers read provider selection on each request, so only their picker
// catalog needs refreshing. The full enable path is reserved for inactive targets.
function runApply() {
  const requested = optionValue("--targets");
  const selected = requested ? requested.split(",").map((value) => value.trim()) : TARGETS;
  const activate = args.includes("--activate");
  const applied = [];
  const skipped = [];
  for (const target of selected) {
    if (!TARGETS.includes(target)) throw new Error(`Unknown target: ${target}`);
    if (!targetIsActive(target) && !activate) {
      skipped.push(target);
      continue;
    }
    if (targetIsActive(target)) {
      refreshActiveTarget(target);
    } else {
      const result = spawnSync(path.join(REPO_ROOT, "bin", "enable"), [], {
        env: { ...process.env, MODEL_ROUTER_TARGET: target },
        stdio: "inherit",
      });
      if (result.status !== 0) throw new Error(`${target}: apply failed`);
    }
    applied.push(target);
  }
  process.stderr.write(
    `Applied: ${applied.join(", ") || "none"}. Skipped (not active): ${skipped.join(", ") || "none"}.\n`,
  );
}

async function printAccountUsage() {
  const { readCodexAccountUsage } = await import("./codex-account-usage.mjs");
  process.stdout.write(`${JSON.stringify(await readCodexAccountUsage(), null, 2)}\n`);
}

async function printProviderUsage() {
  const { providerUsageSnapshot } = await import("./provider-usage.mjs");
  process.stdout.write(`${JSON.stringify(await providerUsageSnapshot(), null, 2)}\n`);
}

async function printProviderOnboarding() {
  const { providerOnboardingSnapshot } = await import("./provider-onboarding.mjs");
  process.stdout.write(`${JSON.stringify(providerOnboardingSnapshot(), null, 2)}\n`);
}

async function installProviderCli(providerId) {
  const { installOauthCli, providerOnboardingSnapshot } = await import("./provider-onboarding.mjs");
  installOauthCli(providerId);
  process.stdout.write(`${JSON.stringify(providerOnboardingSnapshot())}\n`);
}

async function loginProvider(providerId) {
  const { loginOauthProvider, providerOnboardingSnapshot } = await import("./provider-onboarding.mjs");
  loginOauthProvider(providerId);
  process.stdout.write(`${JSON.stringify(providerOnboardingSnapshot())}\n`);
}

async function readSecretFromStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error("The API key is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function saveProviderCredential(providerId) {
  const { providerOnboardingSnapshot, saveApiCredential } = await import("./provider-onboarding.mjs");
  saveApiCredential(providerId, await readSecretFromStdin());
  process.stdout.write(`${JSON.stringify(providerOnboardingSnapshot())}\n`);
}

async function setLoginFreeMode(desired) {
  if (desired !== "on" && desired !== "off") {
    throw new Error("Usage: control auth-mode <on|off>");
  }
  let loginFreeModel;
  if (desired === "on") {
    const { providerOnboardingSnapshot } = await import("./provider-onboarding.mjs");
    const { readProviderSelection, selectedListedModels } = await import("./provider-selection.mjs");
    const { MODEL_BY_SLUG } = await import("./model-registry.mjs");
    const { readNativeAliases } = await import("./native-alias.mjs");
    const selected = new Set(readProviderSelection());
    const readyProviders = new Set(
      providerOnboardingSnapshot().providers
        .filter((provider) => selected.has(provider.id) && provider.configured)
        .map((provider) => provider.id),
    );
    if (readyProviders.size === 0) {
      throw new Error(
        "Connect and enable at least one external provider before turning on login-free mode.",
      );
    }
    const currentModel = codexConfigSnapshot()?.model;
    const currentRoute =
      MODEL_BY_SLUG.get(currentModel) ??
      MODEL_BY_SLUG.get(readNativeAliases()[currentModel]);
    loginFreeModel =
      currentRoute && readyProviders.has(currentRoute.provider)
        ? currentRoute.slug
        : selectedListedModels().find((model) => readyProviders.has(model.provider))?.slug;
    if (!loginFreeModel) {
      throw new Error("No enabled model is available for the connected external providers.");
    }
  }
  const catalog = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "src", "catalog.mjs")],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        MODEL_ROUTER_TARGET: "codex",
        MODEL_ROUTER_LOGIN_FREE: desired === "on" ? "1" : "0",
      },
      encoding: "utf8",
    },
  );
  if (catalog.status !== 0) {
    throw new Error((catalog.stderr || "Codex model catalog could not be refreshed.").trim());
  }
  if (loginFreeModel) {
    const { nativeAliasFor } = await import("./native-alias.mjs");
    loginFreeModel = nativeAliasFor(loginFreeModel) || loginFreeModel;
  }
  const command = desired === "on" ? "login-free-enable" : "login-free-disable";
  const commandArgs = [path.join(REPO_ROOT, "src", "config-manager.mjs"), command];
  if (loginFreeModel) commandArgs.push(loginFreeModel);
  const result = spawnSync(
    process.execPath,
    commandArgs,
    {
      cwd: REPO_ROOT,
      env: { ...process.env, MODEL_ROUTER_TARGET: "codex" },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error((result.stderr || "Codex provider mode could not be changed.").trim());
  }
  process.stdout.write(result.stdout);
}

function restartCodexApp() {
  if (process.env.NODE_ENV === "test") {
    const marker = process.env.CODEX_ROUTER_TEST_RESTART_MARKER;
    if (!marker || !path.isAbsolute(marker)) {
      throw new Error("The test restart marker is missing.");
    }
    appendFileSync(marker, "called\n", { encoding: "utf8", mode: 0o600 });
    return;
  }

  if (process.platform !== "darwin") {
    throw new Error("Codex graceful restart is available only on macOS.");
  }
  const quit = spawnSync(
    "/usr/bin/osascript",
    ["-e", 'tell application id "com.openai.codex" to quit'],
    { encoding: "utf8", env: {} },
  );
  if (quit.error || quit.status !== 0) {
    throw new Error(
      (quit.stderr || quit.error?.message || "Codex did not accept a graceful quit request.").trim(),
    );
  }
  const reopen = spawnSync("/usr/bin/open", ["-b", "com.openai.codex"], {
    encoding: "utf8",
    env: {},
  });
  if (reopen.error || reopen.status !== 0) {
    throw new Error(
      (reopen.stderr || reopen.error?.message || "Codex could not be reopened.").trim(),
    );
  }
}

function rollbackModelState(snapshots) {
  const restoreTargets = [
    [CONFIG_PATH, snapshots.config],
    [PROVIDER_SELECTION_PATH, snapshots.providers],
    [MERGED_CATALOG_PATH, snapshots.catalog],
    [NATIVE_ALIAS_PATH, snapshots.aliases],
  ];
  let rollbackError;
  for (const [filePath, snapshot] of restoreTargets) {
    try {
      restoreFile(filePath, snapshot);
    } catch (error) {
      rollbackError ||= error;
    }
  }
  try {
    restoreManagedAgents(snapshots.agents);
  } catch (error) {
    rollbackError ||= error;
  }
  if (rollbackError) {
    throw new Error(
      `Model selection rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
    );
  }
}

function restartOption() {
  const inline = args.find((value) => value.startsWith("--restart="));
  const separate = args.indexOf("--restart");
  const value = inline
    ? inline.slice("--restart=".length)
    : separate === -1
      ? undefined
      : args[separate + 1];
  if (separate !== -1 && separate === args.length - 1) {
    throw new Error("Usage: control model-set <model-slug> [--restart=true|false]");
  }
  if (value === undefined) return false;
  if (value !== "true" && value !== "false") {
    throw new Error("Usage: control model-set <model-slug> [--restart=true|false]");
  }
  if (inline && separate !== -1) {
    throw new Error("Usage: control model-set <model-slug> [--restart=true|false]");
  }
  return value === "true";
}

async function setCodexModel(slug, restart = false) {
  const value = String(slug || "").trim();
  if (!value) throw new Error("Usage: control model-set <model-slug>");
  const config = codexConfigSnapshot();
  const { MODEL_BY_SLUG, PROVIDERS } = await import("./model-registry.mjs");
  const {
    readProviderSelection,
    writeProviderSelection,
  } = await import("./provider-selection.mjs");
  const { credentialStatus } = await import("./provider-credentials.mjs");
  const route = MODEL_BY_SLUG.get(value);
  const nativeModels = nativeCodexModels(NATIVE_CATALOG_PATH);
  const native = nativeModels.some((model) => model.slug === value);
  if (!route && !native) throw new Error(`Unknown Codex model: ${value}`);
  if (native && config?.login_free) {
    throw new Error("Native GPT models are unavailable while login-free mode is active.");
  }

  const snapshots = {
    config: snapshotFile(CONFIG_PATH),
    providers: snapshotFile(PROVIDER_SELECTION_PATH),
    catalog: snapshotFile(MERGED_CATALOG_PATH),
    aliases: snapshotFile(NATIVE_ALIAS_PATH),
    agents: snapshotManagedAgents(),
  };
  if (route) {
    const provider = PROVIDERS.get(route.provider);
    if (!credentialStatus(provider, { persistent: true }).configured) {
      throw new Error(`${value} is not an authenticated external model.`);
    }
    const current = readProviderSelection();
    if (!current.includes(route.provider)) {
      writeProviderSelection([...current, route.provider]);
    }
  }

  const rollback = (originalError) => {
    try {
      rollbackModelState(snapshots);
    } catch (rollbackError) {
      throw new Error(
        `${originalError instanceof Error ? originalError.message : String(originalError)}; ${rollbackError.message}`,
      );
    }
  };

  if (route) {
    const catalog = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "src", "catalog.mjs")],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, MODEL_ROUTER_TARGET: "codex" },
        encoding: "utf8",
      },
    );
    if (catalog.status !== 0) {
      const error = new Error((catalog.stderr || "Codex model catalog could not be refreshed.").trim());
      rollback(error);
      throw error;
    }
  }

  let configModel = value;
  if (route && config?.login_free) {
    const { nativeAliasFor } = await import("./native-alias.mjs");
    configModel = nativeAliasFor(value) || value;
  }
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "src", "config-manager.mjs"), "model-set", configModel],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, MODEL_ROUTER_TARGET: "codex" },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    const error = new Error((result.stderr || "The Codex model could not be changed.").trim());
    rollback(error);
    throw error;
  }

  if (restart) {
    try {
      restartCodexApp();
    } catch (error) {
      rollback(error);
      throw error;
    }
  }

  let saved;
  try {
    saved = JSON.parse(result.stdout);
  } catch (error) {
    rollback(error);
    throw new Error("The Codex model change returned invalid JSON.");
  }
  process.stdout.write(
    `${JSON.stringify({
      ...saved,
      selectedModel: value,
      restartRequired: !restart,
      restarted: restart,
    })}\n`,
  );
}

async function setNextTaskModel(slug, { restart = false } = {}) {
  return setCodexModel(slug, restart);
}

function runCodexRestart() {
  restartCodexApp();
  process.stdout.write(`${JSON.stringify({ restarted: true, restartRequired: false })}\n`);
}

async function updateAndVerifyCodex() {
  const { runCodexMaintenance } = await import("./codex-maintenance.mjs");
  process.stdout.write(`${JSON.stringify(runCodexMaintenance())}\n`);
}

// --- dispatch ---------------------------------------------------------------

if (args.includes("--probe")) {
  await emitProbe();
} else if (args[0] === "--probe-set") {
  await emitProbeSet(args[1], args[2]);
} else if (args[0] === "set") {
  if (!args[1] || !args[2]) throw new Error("Usage: control set <provider> <on|off> [--targets ...]");
  runSet(args[1], args[2]);
} else if (args[0] === "apply") {
  runApply();
} else if (args[0] === "account") {
  await printAccountUsage();
} else if (args[0] === "provider-usage") {
  await printProviderUsage();
} else if (args[0] === "providers") {
  await printProviderOnboarding();
} else if (args[0] === "install-cli") {
  if (!args[1]) throw new Error("Usage: control install-cli <oauth-provider>");
  await installProviderCli(args[1]);
} else if (args[0] === "login") {
  if (!args[1]) throw new Error("Usage: control login <oauth-provider>");
  await loginProvider(args[1]);
} else if (args[0] === "credential") {
  if (!args[1]) throw new Error("Usage: control credential <api-provider>");
  await saveProviderCredential(args[1]);
} else if (args[0] === "auth-mode") {
  await setLoginFreeMode(args[1]);
} else if (args[0] === "model-catalog") {
  if (!args.includes("--json")) {
    throw new Error("Usage: control model-catalog --json");
  }
  process.stdout.write(`${JSON.stringify(modelCatalogSnapshot())}\n`);
} else if (args[0] === "model-set") {
  await setNextTaskModel(args[1], { restart: restartOption() });
} else if (args[0] === "codex-restart") {
  runCodexRestart();
} else if (args[0] === "maintenance") {
  await updateAndVerifyCodex();
} else {
  printOverview(args.includes("--json"));
}
