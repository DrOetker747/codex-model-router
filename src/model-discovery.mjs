import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MODELS, PROVIDERS } from "./model-registry.mjs";
import { credentialStatus, resolveProviderCredential } from "./provider-credentials.mjs";

export const MODEL_DISCOVERY_TIMEOUT_MS = 30_000;

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

export function normalizeModelCatalog(payload) {
  const data = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : payload?.models;
  if (!Array.isArray(data)) throw new Error("The provider returned an invalid model list.");
  return [...new Set(
    data
      .map((item) => (typeof item === "string" ? item : item?.id))
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  )].sort();
}

function providerFor(providerOrId) {
  const provider = typeof providerOrId === "string" ? PROVIDERS.get(providerOrId) : providerOrId;
  if (!provider?.id) throw new Error(`Unknown provider: ${String(providerOrId)}`);
  return provider;
}

function diagnosticCause(error, fallback = "provider catalog request failed") {
  const message = String(error?.message || error || fallback)
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:api[-_ ]?key|token|secret)[=: ]+\S+/gi, "$1 [redacted]");
  const cause = new Error(message || fallback);
  cause.name = error?.name || "Error";
  return cause;
}

export async function fetchProviderCatalog(providerOrId, options = {}) {
  const provider = providerFor(providerOrId);
  if (provider.kind !== "openai-compatible") {
    throw new Error(`${provider.displayName} does not expose a supported API-key model-list endpoint.`);
  }
  const fixture = options.fixture || option("--fixture");
  if (fixture) {
    try {
      return JSON.parse(readFileSync(path.resolve(fixture), "utf8"));
    } catch (error) {
      throw new Error(`Provider ${provider.id} returned invalid JSON.`, {
        cause: diagnosticCause(error, "invalid JSON"),
      });
    }
  }

  const endpoint = String(provider.modelDiscovery?.endpoint || "").trim();
  if (!endpoint.startsWith("/")) {
    throw new Error(`Provider ${provider.id} has no safe model-discovery endpoint capability.`);
  }

  const injectedFetch = typeof options.fetchImpl === "function";
  const credential = options.credential ||
    (injectedFetch ? undefined : resolveProviderCredential(provider));
  if (!credential && !injectedFetch) throw new Error(credentialStatus(provider).setup);
  const baseUrl = String(process.env[provider.baseUrlEnv] || provider.baseUrl).replace(/\/+$/, "");
  const headers = credential
    ? provider.protocol === "anthropic"
      ? { "x-api-key": credential.value, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${credential.value}` }
    : {};
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Fetch is not available in this Node.js runtime.");
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, options.timeoutMs)
    : MODEL_DISCOVERY_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/models`, {
      headers,
      signal: options.signal || controller.signal,
    });
  } catch (error) {
    if (timedOut || error?.name === "AbortError" || error?.name === "TimeoutError") {
      const cause = timedOut
        ? diagnosticCause(new Error("request timeout"), "request timeout")
        : diagnosticCause(error, "request timeout");
      cause.name = "TimeoutError";
      throw new Error(`Provider ${provider.id} catalog request timed out.`, { cause });
    }
    throw new Error(`Provider ${provider.id} catalog request failed.`, {
      cause: diagnosticCause(error),
    });
  } finally {
    clearTimeout(timer);
  }

  const responseOk = response?.ok === true ||
    (response?.ok !== false && Number(response?.status) >= 200 && Number(response?.status) < 300);
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`Provider ${provider.id} returned invalid JSON.`, {
      cause: diagnosticCause(error, "invalid JSON"),
    });
  }
  if (!responseOk) {
    const status = response?.status ?? "unknown";
    throw new Error(`Provider model discovery returned HTTP ${status}.`, {
      cause: diagnosticCause(new Error(`HTTP ${status}`)),
    });
  }
  return payload;
}

async function providerPayload(provider, options = {}) {
  return fetchProviderCatalog(provider, options);
}

export async function discoverProviderModels(providerId, options = {}) {
  const provider = PROVIDERS.get(providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  if (provider.kind !== "openai-compatible") {
    throw new Error(`${provider.displayName} does not expose a supported API-key model-list endpoint.`);
  }
  const payload = options.fetchCatalog
    ? await options.fetchCatalog(providerId, provider)
    : await providerPayload(provider, options);
  const discovered = normalizeModelCatalog(payload);
  const registered = MODELS
    .filter((model) => model.provider === providerId)
    .map((model) => model.upstreamModel)
    .sort();
  const discoveredSet = new Set(discovered);
  const registeredSet = new Set(registered);
  return {
    provider: providerId,
    discovered,
    registered,
    unregistered: discovered.filter((id) => !registeredSet.has(id)),
    unavailable: registered.filter((id) => !discoveredSet.has(id)),
    note: "Discovery never edits the registry. New models must pass the live compatibility test before they are listed in Codex.",
  };
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write(`Usage: discover-models PROVIDER [--fixture FILE] [--json]

Queries an API-key provider's official /models endpoint and compares it with
config/providers.json. Credential values are never printed or written.
`);
    return;
  }
  const providerId = process.argv.slice(2).find((value) => !value.startsWith("--") && value !== option("--fixture"));
  if (!providerId) throw new Error("Pass a provider id, such as anthropic-api, deepseek, grok-api, or kimi-api.");
  const result = await discoverProviderModels(providerId);
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${result.provider}: ${result.discovered.length} models discovered\n`);
    process.stdout.write(`Registered: ${result.registered.join(", ") || "none"}\n`);
    process.stdout.write(`New candidates: ${result.unregistered.join(", ") || "none"}\n`);
    process.stdout.write(`Unavailable registered ids: ${result.unavailable.join(", ") || "none"}\n`);
    process.stdout.write(`${result.note}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
