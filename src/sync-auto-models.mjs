import path from "node:path";
import { fileURLToPath } from "node:url";

import { discoverProviderModels } from "./model-discovery.mjs";
import { PROVIDERS, STATIC_MODELS } from "./model-registry.mjs";
import { credentialStatus } from "./provider-credentials.mjs";
import { readUserModels, userModelEntry, writeUserModels } from "./user-models.mjs";

function modelLabel(id, providerName) {
  const label = String(id)
    .split("-")
    .map((part) => {
      if (/^gpt$/i.test(part)) return "GPT";
      if (/^glm$/i.test(part)) return "GLM";
      if (/^kimi$/i.test(part)) return "Kimi";
      if (/^grok$/i.test(part)) return "Grok";
      if (/^qwen/i.test(part)) return part.replace(/^qwen/i, "Qwen");
      if (/^minimax$/i.test(part)) return "MiniMax";
      if (/^deepseek$/i.test(part)) return "DeepSeek";
      if (/^mimo$/i.test(part)) return "MiMo";
      return part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1);
    })
    .join(" ");
  return `${label} (${providerName})`;
}

function hasPrefix(id, prefixes) {
  return (prefixes || []).some((prefix) => id.startsWith(prefix));
}

export function discoveredProtocol(provider, id) {
  if (hasPrefix(id, provider.responsesModelPrefixes)) return "responses";
  if (hasPrefix(id, provider.anthropicModelPrefixes)) return "anthropic";
  return "openai";
}

function sameModels(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function numericVersion(value) {
  return String(value)
    .split(".")
    .map((part) => Number.parseInt(part, 10));
}

function compareVersions(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function openCodeGoSotaCandidate(id) {
  const rules = [
    [/^kimi-k(\d+(?:\.\d+)*)(?:-.*)?$/, () => "kimi"],
    [/^minimax-m(\d+(?:\.\d+)*)$/, () => "minimax"],
    [/^grok-(\d+(?:\.\d+)*)$/, () => "grok"],
    [/^glm-(\d+(?:\.\d+)*)$/, () => "glm"],
    [/^gpt-(\d+(?:\.\d+)*)-(luna)$/, (match) => `gpt:${match[2]}`],
    [
      /^deepseek-v(\d+(?:\.\d+)*)-(flash|pro)$/,
      (match) => `deepseek:${match[2]}`,
    ],
    [/^qwen(\d+(?:\.\d+)*)-(max|plus)$/, (match) => `qwen:${match[2]}`],
    [/^mimo-v(\d+(?:\.\d+)*)(?:-(pro))?$/, (match) => `mimo:${match[2] || "standard"}`],
    [/^hy(\d+(?:\.\d+)*)$/, () => "hy"],
  ];
  for (const [pattern, key] of rules) {
    const match = String(id).match(pattern);
    if (match) return { id, key: key(match), version: numericVersion(match[1]) };
  }
  return undefined;
}

export function pickerModelIds(providerId, discovered) {
  const provider = PROVIDERS.get(providerId);
  if (provider?.pickerPolicy === "hide-all") return new Set();
  if (providerId !== "opencode-go") return new Set(discovered);
  const best = new Map();
  for (const id of [...new Set(discovered)].sort()) {
    const candidate = openCodeGoSotaCandidate(id);
    if (!candidate) continue;
    const current = best.get(candidate.key);
    const comparison = current
      ? compareVersions(candidate.version, current.version)
      : 1;
    if (
      !current ||
      comparison > 0 ||
      (comparison === 0 && candidate.id.length < current.id.length)
    ) {
      best.set(candidate.key, candidate);
    }
  }
  return new Set([...best.values()].map((candidate) => candidate.id));
}

export function filteredDiscoveredModelIds(provider, discovered) {
  const patterns = (provider.modelAllowPatterns || []).map((value) => new RegExp(value));
  const unique = [...new Set(discovered)];
  return patterns.length
    ? unique.filter((id) => patterns.some((pattern) => pattern.test(id)))
    : unique;
}

export function mergeDiscoveredModels(providerId, discovered) {
  const provider = PROVIDERS.get(providerId);
  if (!provider?.autoSyncModels) {
    throw new Error(`Provider ${providerId} does not enable automatic model sync.`);
  }
  const registered = new Set(
    STATIC_MODELS.filter((model) => model.provider === providerId).map(
      (model) => model.upstreamModel,
    ),
  );
  const existing = readUserModels();
  const others = existing.filter(
    (model) => model.provider !== providerId || model.autoDiscovered !== providerId,
  );
  const existingById = new Map(
    existing
      .filter((model) => model.provider === providerId)
      .map((model) => [model.upstreamModel, model]),
  );
  const manualIds = new Set(
    existing
      .filter(
        (model) => model.provider === providerId && model.autoDiscovered !== providerId,
      )
      .map((model) => model.upstreamModel),
  );
  const filtered = filteredDiscoveredModelIds(provider, discovered);
  const ids = filtered
    .filter((id) => !registered.has(id) && !manualIds.has(id))
    .sort();
  const pickerIds = pickerModelIds(providerId, filtered);
  const synced = ids.map((id, index) => {
    const current = existingById.get(id);
    const pickerVisibility = pickerIds.has(id) ? "list" : "hide";
    if (current) return { ...current, pickerVisibility };
    return userModelEntry({
      providerId,
      upstreamId: id,
      priority: 100 + index,
      protocol: discoveredProtocol(provider, id),
      displayName: modelLabel(id, provider.displayName),
      description: `${modelLabel(id, provider.displayName)} discovered from the provider catalog with conservative compatibility metadata.`,
      autoDiscovered: providerId,
      pickerVisibility,
    });
  });
  const next = [...others, ...synced];
  if (sameModels(existing, next)) {
    return { changed: false, path: undefined, models: synced.length };
  }
  return { changed: true, path: writeUserModels(next), models: synced.length };
}

export async function syncProvider(providerId) {
  const discovery = await discoverProviderModels(providerId);
  const provider = PROVIDERS.get(providerId);
  const filtered = filteredDiscoveredModelIds(provider, discovery.discovered);
  return {
    provider: providerId,
    discovered: filtered.length,
    ...mergeDiscoveredModels(providerId, discovery.discovered),
  };
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "Usage: sync-auto-models.mjs [PROVIDER]\nSyncs providers marked autoSyncModels from their read-only /models catalog.\n",
    );
    return;
  }
  const requested = process.argv.slice(2).find((value) => !value.startsWith("--"));
  const ids = requested
    ? [requested]
    : [...PROVIDERS.values()]
        .filter(
          (provider) =>
            provider.autoSyncModels && credentialStatus(provider, { persistent: true }).configured,
        )
        .map((provider) => provider.id);
  const results = [];
  for (const id of ids) results.push(await syncProvider(id));
  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`codex-router model sync: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
