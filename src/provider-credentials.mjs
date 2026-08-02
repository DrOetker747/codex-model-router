import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { protectPrivateFile } from "./file-security.mjs";
import { LEGACY_STATE_DIRS, STATE_DIR, TARGET } from "./paths.mjs";
import { PROVIDERS } from "./model-registry.mjs";

export function apiProvider(providerId) {
  const provider = PROVIDERS.get(providerId);
  if (!provider || provider.kind !== "openai-compatible") {
    throw new Error(`Unknown API-key provider: ${providerId}`);
  }
  return provider;
}

export function primaryCredentialPath(provider) {
  return path.join(STATE_DIR, provider.credential.file);
}

export function fallbackCredentialPaths(provider) {
  return (provider.credential.fallbackFiles || []).map((name) => path.join(STATE_DIR, name));
}

export function credentialPaths(provider) {
  const names = [
    provider.credential.file,
    ...(provider.credential.fallbackFiles || []),
    ...(provider.credential.legacyFiles || []),
  ];
  const candidates = names.flatMap((name) => [
    path.join(STATE_DIR, name),
    ...LEGACY_STATE_DIRS.map((directory) => path.join(directory, name)),
  ]);
  return [...new Set(candidates)];
}

function keyFromKeychain(provider) {
  if (process.platform !== "darwin" || TARGET !== "codex") return undefined;
  for (const service of provider.credential.keychainServices || []) {
    try {
      const value = execFileSync(
        "/usr/bin/security",
        ["find-generic-password", "-s", service, "-a", "default", "-w"],
        { encoding: "utf8", timeout: 2_000, stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      if (value) return { value, source: `macOS Keychain (${service})` };
    } catch {
      // Try the next compatible service name.
    }
  }
  return undefined;
}

export function resolveProviderCredential(providerOrId, options = {}) {
  return resolveProviderCredentials(providerOrId, options)[0];
}

export function resolveProviderCredentials(providerOrId, options = {}) {
  const provider =
    typeof providerOrId === "string" ? apiProvider(providerOrId) : providerOrId;
  const credentials = [];
  const seen = new Set();
  const add = (credential) => {
    if (!credential?.value || seen.has(credential.value)) return;
    seen.add(credential.value);
    credentials.push(credential);
  };
  if (!options.persistent) {
    for (const name of provider.credential.environment) {
      const value = process.env[name]?.trim();
      if (value) add({ value, source: `environment (${name})`, persistent: false });
    }
  }
  for (const candidate of credentialPaths(provider)) {
    if (!existsSync(candidate)) continue;
    const value = readFileSync(candidate, "utf8").trim();
    if (value) {
      add({ value, source: `protected file (${candidate})`, persistent: true });
    }
  }
  const keychain = keyFromKeychain(provider);
  if (keychain) add({ ...keychain, persistent: true });
  return credentials;
}

export function credentialStatus(providerOrId, options = {}) {
  const provider =
    typeof providerOrId === "string" ? apiProvider(providerOrId) : providerOrId;
  const credential = resolveProviderCredential(provider, options);
  return credential
    ? { configured: true, source: credential.source, persistent: credential.persistent }
    : {
        configured: false,
        setup: TARGET === "cursor"
          ? `Run ./bin/model-router cursor provider-key ${provider.id} set`
          : `Run ./bin/provider-key ${provider.id} set`,
      };
}

export function writeProviderCredential(providerOrId, value) {
  const provider =
    typeof providerOrId === "string" ? apiProvider(providerOrId) : providerOrId;
  return writeCredentialFile(primaryCredentialPath(provider), value);
}

export function writeProviderFallbackCredential(providerOrId, value, index = 0) {
  const provider =
    typeof providerOrId === "string" ? apiProvider(providerOrId) : providerOrId;
  const target = fallbackCredentialPaths(provider)[index];
  if (!target) throw new Error(`${provider.displayName} has no backup key slot.`);
  return writeCredentialFile(target, value);
}

function writeCredentialFile(target, value) {
  const key = String(value || "").trim();
  if (!key) throw new Error("No API key was entered; nothing changed.");
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  chmodSync(STATE_DIR, 0o700);
  const temporary = `${target}.tmp.${process.pid}`;
  writeFileSync(temporary, `${key}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    protectPrivateFile(temporary);
    renameSync(temporary, target);
    protectPrivateFile(target);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
  return target;
}

export function removeProviderCredential(providerOrId) {
  const provider =
    typeof providerOrId === "string" ? apiProvider(providerOrId) : providerOrId;
  let removed = 0;
  for (const candidate of credentialPaths(provider)) {
    if (!existsSync(candidate)) continue;
    unlinkSync(candidate);
    removed += 1;
  }
  return removed;
}

export function credentialFileMode(providerOrId) {
  const provider =
    typeof providerOrId === "string" ? apiProvider(providerOrId) : providerOrId;
  const target = primaryCredentialPath(provider);
  return existsSync(target) ? statSync(target).mode & 0o777 : undefined;
}
