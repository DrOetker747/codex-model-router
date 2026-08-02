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
  const ids = [...new Set(discovered)]
    .filter((id) => !registered.has(id) && !manualIds.has(id))
    .sort();
  const synced = ids.map((id, index) => {
    const current = existingById.get(id);
    if (current) return current;
    return userModelEntry({
      providerId,
      upstreamId: id,
      priority: 100 + index,
      protocol: discoveredProtocol(provider, id),
      displayName: modelLabel(id, provider.displayName),
      description: `${modelLabel(id, provider.displayName)} discovered from the provider catalog with conservative compatibility metadata.`,
      autoDiscovered: providerId,
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
  return {
    provider: providerId,
    discovered: discovery.discovered.length,
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
