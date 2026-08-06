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
import { targetCli } from "./target-integration.mjs";
import { PROVIDERS } from "./model-registry.mjs";

export function apiProvider(providerId) {
  const provider = PROVIDERS.get(providerId);
  if (!provider || provider.kind !== "openai-compatible") {
    throw new Error(`Unknown API-key provider: ${providerId}`);
  }
  return provider;
}

export const MAX_KEY_SLOTS = 5;

export function primaryCredentialPath(provider) {
  return path.join(STATE_DIR, provider.credential.file);
}

// Slot 0 is the provider's primary key file; higher slots live alongside it
// as `<name>-2.secret` .. `<name>-5.secret` so a single provider can hold
// several billed subscriptions and rotate between them on exhaustion.
export function slotCredentialFile(provider, slotIndex) {
  if (slotIndex === 0) return provider.credential.file;
  const base = provider.credential.file.replace(/\.secret$/, "");
  return `${base}-${slotIndex + 1}.secret`;
}

export function credentialPaths(provider) {
  const names = [provider.credential.file, ...(provider.credential.legacyFiles || [])];
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
  const provider =
    typeof providerOrId === "string" ? apiProvider(providerOrId) : providerOrId;
  if (!options.persistent) {
    for (const name of provider.credential.environment) {
      const value = process.env[name]?.trim();
      if (value) return { value, source: `environment (${name})`, persistent: false };
    }
  }
  for (const candidate of credentialPaths(provider)) {
    if (!existsSync(candidate)) continue;
    const value = readFileSync(candidate, "utf8").trim();
    if (value) {
      return { value, source: `protected file (${candidate})`, persistent: true };
    }
  }
  const keychain = keyFromKeychain(provider);
  return keychain ? { ...keychain, persistent: true } : undefined;
}

// All key slots configured for a provider, slot 0 first. Slot 0 honors the
// environment override and legacy key locations exactly like
// resolveProviderCredential; higher slots are numbered files in the state dir.
export function resolveProviderCredentialSlots(providerOrId, options = {}) {
  const provider =
    typeof providerOrId === "string" ? apiProvider(providerOrId) : providerOrId;
  const slots = [];
  if (!options.persistent) {
    for (const name of provider.credential.environment) {
      const value = process.env[name]?.trim();
      if (value) {
        slots.push({ value, source: `environment (${name})`, persistent: false, slot: 0 });
        break;
      }
    }
  }
  for (const candidate of credentialPaths(provider)) {
    if (!existsSync(candidate)) continue;
    const value = readFileSync(candidate, "utf8").trim();
    if (value) {
      slots.push({ value, source: `protected file (${candidate})`, persistent: true, slot: 0 });
      break;
    }
  }
  for (let slot = 1; slot < MAX_KEY_SLOTS; slot += 1) {
    const candidate = path.join(STATE_DIR, slotCredentialFile(provider, slot));
    if (!existsSync(candidate)) continue;
    const value = readFileSync(candidate, "utf8").trim();
    if (value) {
      slots.push({ value, source: `protected file (${candidate})`, persistent: true, slot });
    }
  }
  if (slots.length === 0) {
    const keychain = keyFromKeychain(provider);
    if (keychain) slots.push({ ...keychain, persistent: true, slot: 0 });
  }
  return slots;
}

export function credentialStatus(providerOrId, options = {}) {
  const provider =
    typeof providerOrId === "string" ? apiProvider(providerOrId) : providerOrId;
  const credential = resolveProviderCredential(provider, options);
  return credential
    ? { configured: true, source: credential.source, persistent: credential.persistent }
    : {
        configured: false,
        setup: `Run ${targetCli(`provider-key ${provider.id} set`)}`,
      };
}

export function writeProviderCredential(providerOrId, value) {
  return writeProviderCredentialSlot(providerOrId, value, 0);
}

export function writeProviderCredentialSlot(providerOrId, value, slotIndex = 0) {
  const provider =
    typeof providerOrId === "string" ? apiProvider(providerOrId) : providerOrId;
  const key = String(value || "").trim();
  if (!key) throw new Error("No API key was entered; nothing changed.");
  const slot = Number(slotIndex);
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_KEY_SLOTS) {
    throw new Error(`API key slot must be between 1 and ${MAX_KEY_SLOTS}.`);
  }
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  chmodSync(STATE_DIR, 0o700);
  const target = path.join(STATE_DIR, slotCredentialFile(provider, slot));
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
  for (let slot = 1; slot < MAX_KEY_SLOTS; slot += 1) {
    const candidate = path.join(STATE_DIR, slotCredentialFile(provider, slot));
    if (!existsSync(candidate)) continue;
    unlinkSync(candidate);
    removed += 1;
  }
  return removed;
}

export function removeProviderCredentialSlot(providerOrId, slotIndex) {
  const provider =
    typeof providerOrId === "string" ? apiProvider(providerOrId) : providerOrId;
  const slot = Number(slotIndex);
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_KEY_SLOTS) {
    throw new Error(`API key slot must be between 1 and ${MAX_KEY_SLOTS}.`);
  }
  const target = path.join(STATE_DIR, slotCredentialFile(provider, slot));
  if (!existsSync(target)) return 0;
  unlinkSync(target);
  return 1;
}

export function credentialFileMode(providerOrId) {
  const provider =
    typeof providerOrId === "string" ? apiProvider(providerOrId) : providerOrId;
  const target = primaryCredentialPath(provider);
  return existsSync(target) ? statSync(target).mode & 0o777 : undefined;
}
