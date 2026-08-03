import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchProviderCatalog,
  normalizeModelCatalog,
  normalizeModelCatalogRecords,
} from "./model-discovery.mjs";
import { PROVIDERS, STATIC_MODELS } from "./model-registry.mjs";
import {
  readProviderLkg,
  unavailableLkg,
  writeProviderLkg,
} from "./catalog-lkg.mjs";
import { credentialStatus } from "./provider-credentials.mjs";
import { withCatalogSingleFlight } from "./service-operation-lock.mjs";
import { selectSotaModelIds } from "./sota-ranking.mjs";
import { STATE_DIR } from "./paths.mjs";
import { readProviderSelection } from "./provider-selection.mjs";
import { readUserModels, userModelEntry, writeUserModels } from "./user-models.mjs";

export const CATALOG_SYNC_MAX_ATTEMPTS = 3;
export const CATALOG_SYNC_BACKOFF_BASE_MS = 250;
export const CATALOG_SYNC_BACKOFF_MAX_MS = 2_000;
export const CATALOG_SYNC_LOCK_PATH = path.join(STATE_DIR, "catalog-sync");

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

export function pickerModelIds(providerId, discovered) {
  const provider = PROVIDERS.get(providerId);
  if (provider?.pickerPolicy === "hide-all") return new Set();
  return provider?.modelDiscovery?.endpoint
    ? selectSotaModelIds(discovered)
    : new Set(discovered);
}

export function filteredDiscoveredModelIds(provider, discovered) {
  const patterns = (provider.modelAllowPatterns || []).map((value) => new RegExp(value));
  const unique = [...new Set(discovered)];
  return patterns.length
    ? unique.filter((id) => patterns.some((pattern) => pattern.test(id)))
    : unique;
}

function catalogMetadata(metadata = {}) {
  const result = {};
  if (metadata.state) result.catalogState = metadata.state;
  return result;
}

export function mergeDiscoveredModels(providerId, discovered, metadata = {}, rankingRecords = discovered) {
  const provider = PROVIDERS.get(providerId);
  if (!provider?.modelDiscovery?.endpoint) {
    throw new Error(`Provider ${providerId} does not declare a model-discovery endpoint.`);
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
  const discoveredIds = new Set(ids);
  const filteredSet = new Set(filtered);
  const rankingInput = [...rankingRecords].filter((record) => {
    const id = typeof record === "string" ? record : String(record?.id || "");
    return filteredSet.has(id);
  });
  const pickerIds = pickerModelIds(providerId, rankingInput);
  const provenance = catalogMetadata(metadata);
  const retained = existing
    .filter(
      (model) =>
        model.provider === providerId &&
        model.autoDiscovered === providerId &&
        !discoveredIds.has(model.upstreamModel),
    )
    .map((model) => ({ ...model, pickerVisibility: "hide" }));
  const synced = ids.map((id, index) => {
    const current = existingById.get(id);
    const pickerVisibility = pickerIds.has(id) ? "list" : "hide";
    if (current) return { ...current, pickerVisibility, ...provenance };
    return userModelEntry({
      providerId,
      upstreamId: id,
      priority: 100 + index,
      protocol: discoveredProtocol(provider, id),
      displayName: modelLabel(id, provider.displayName),
      description: `${modelLabel(id, provider.displayName)} discovered from the provider catalog with conservative compatibility metadata.`,
      autoDiscovered: providerId,
      pickerVisibility,
      ...provenance,
    });
  });
  const next = [...others, ...retained, ...synced];
  if (sameModels(existing, next)) {
    return { changed: false, path: undefined, models: synced.length };
  }
  return { changed: true, path: writeUserModels(next), models: synced.length };
}

function nowValue(now) {
  const value = typeof now === "function" ? now() : now === undefined ? Date.now() : now;
  if (!Number.isFinite(Number(value))) throw new Error("Catalog sync clock returned an invalid timestamp.");
  return Number(value);
}

function providerIdOf(value) {
  return typeof value === "string" ? value : value?.id;
}

function providerCandidates(enabledProviders, explicit) {
  const values = enabledProviders === undefined
    ? readProviderSelection()
    : enabledProviders;
  const ids = [...new Set(
    (Array.isArray(values) ? values : [...values])
      .map(providerIdOf)
      .filter(Boolean),
  )];
  return ids
    .map((providerId) => {
      const provider = PROVIDERS.get(providerId);
      if (!provider) throw new Error(`Unknown provider: ${providerId}`);
      return provider;
    })
    .filter((provider) => provider.modelDiscovery?.endpoint)
    .filter(
      (provider) =>
        explicit || credentialStatus(provider, { persistent: true }).configured,
    );
}

function sleepFor(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function fetchWithBackoff(provider, fetchCatalog, sleep) {
  let lastError;
  for (let attempt = 0; attempt < CATALOG_SYNC_MAX_ATTEMPTS; attempt += 1) {
    try {
      const payload = await fetchCatalog(provider.id, provider);
      const source = payload?.discovered !== undefined ? payload.discovered : payload;
      return {
        models: normalizeModelCatalog(source),
        records: normalizeModelCatalogRecords(source),
        attempts: attempt + 1,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === CATALOG_SYNC_MAX_ATTEMPTS - 1) break;
      const delay = Math.min(
        CATALOG_SYNC_BACKOFF_MAX_MS,
        CATALOG_SYNC_BACKOFF_BASE_MS * 2 ** attempt,
      );
      await sleep(delay);
    }
  }
  throw Object.assign(new Error(`Provider ${provider.id} catalog sync failed.`), {
    attempts: CATALOG_SYNC_MAX_ATTEMPTS,
    cause: lastError,
  });
}

function failureMessage(error) {
  const cause = failureCause(error);
  if (/timed out|timeout/i.test(cause)) {
    return `Provider catalog request timed out after ${CATALOG_SYNC_MAX_ATTEMPTS} attempts.`;
  }
  if (/invalid json/i.test(cause)) {
    return "Provider catalog returned invalid JSON after retries.";
  }
  return `Provider catalog was unavailable after retries: ${cause}`;
}

function failureCause(error) {
  const messages = [];
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current.message) messages.push(String(current.message));
    current = current.cause;
  }
  return messages
    .join("; ")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:api[-_ ]?key|token|secret)[=: ]+\S+/gi, "$1 [redacted]") ||
    "unknown provider catalog failure";
}

function modelEntries(providerId, modelIds) {
  const wanted = new Set(modelIds);
  return readUserModels().filter(
    (model) =>
      model.provider === providerId &&
      model.autoDiscovered === providerId &&
      wanted.has(model.upstreamModel),
  );
}

function existingAutoModelEntries(providerId) {
  return readUserModels().filter(
    (model) => model.provider === providerId && model.autoDiscovered === providerId,
  );
}

export async function syncEnabledProviderCatalogs({
  enabledProviders,
  fetchCatalog = (providerId) => fetchProviderCatalog(providerId),
  now = Date.now,
  sleep = sleepFor,
} = {}) {
  const explicit = enabledProviders !== undefined;
  const clock = nowValue(now);
  const providers = [];
  const models = [];
  const lkg = {};

  for (const provider of providerCandidates(enabledProviders, explicit)) {
    const previousRecord = readProviderLkg(provider.id, { now: clock });
    let record = previousRecord;
    let catalogModels = previousRecord && previousRecord.state !== "invalid"
      ? previousRecord.models
      : undefined;
    let rankingRecords = catalogModels;
    let attempts = 0;
    let error;
    let cause;
    try {
      const fetched = await fetchWithBackoff(provider, fetchCatalog, sleep);
      attempts = fetched.attempts;
      catalogModels = fetched.models;
      rankingRecords = fetched.records;
      writeProviderLkg(provider.id, {
        models: catalogModels,
        fetchedAt: new Date(clock).toISOString(),
      });
      record = readProviderLkg(provider.id, { now: clock });
    } catch (fetchError) {
      attempts = fetchError?.attempts || CATALOG_SYNC_MAX_ATTEMPTS;
      error = failureMessage(fetchError);
      cause = failureCause(fetchError);
      record = unavailableLkg(previousRecord, { now: clock });
      catalogModels = previousRecord && previousRecord.state !== "invalid"
        ? previousRecord.models
        : undefined;
      rankingRecords = catalogModels;
    }

    const filtered = filteredDiscoveredModelIds(provider, catalogModels || []);
    const merged = catalogModels === undefined
      ? { changed: false, path: undefined, models: existingAutoModelEntries(provider.id).length }
      : mergeDiscoveredModels(provider.id, catalogModels, record, rankingRecords);
    const entries = catalogModels === undefined
      ? existingAutoModelEntries(provider.id)
      : modelEntries(provider.id, filtered);
    models.push(...entries);
    const result = {
      provider: provider.id,
      discovered: filtered.length,
      attempts,
      state: record.state,
      models: merged.models,
      changed: merged.changed,
    };
    if (merged.path) result.path = merged.path;
    if (error) result.error = error;
    if (cause) result.cause = cause;
    providers.push(result);
    lkg[provider.id] = record;
  }

  return { providers, models, lkg };
}

export async function syncProvider(providerId, options = {}) {
  if (!PROVIDERS.has(providerId)) throw new Error(`Unknown provider: ${providerId}`);
  if (!PROVIDERS.get(providerId).modelDiscovery?.endpoint) {
    throw new Error(`Provider ${providerId} does not declare a model-discovery endpoint.`);
  }
  const result = await syncEnabledProviderCatalogs({
    enabledProviders: [providerId],
    fetchCatalog: options.fetchCatalog || ((id) => fetchProviderCatalog(id, options)),
    now: options.now,
    sleep: options.sleep,
  });
  return result.providers[0];
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "Usage: sync-auto-models.mjs [PROVIDER]\nSyncs enabled providers with declared model-discovery capabilities.\n",
    );
    return;
  }
  const requested = process.argv.slice(2).find((value) => !value.startsWith("--"));
  const result = await withCatalogSingleFlight(CATALOG_SYNC_LOCK_PATH, () =>
    syncEnabledProviderCatalogs({
      enabledProviders: requested ? [requested] : undefined,
    }),
  );
  process.stdout.write(`${JSON.stringify({ ...result, results: result.providers }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`codex-router model sync: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
