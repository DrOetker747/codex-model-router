import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { protectPrivateFile } from "./file-security.mjs";
import { STATE_DIR } from "./paths.mjs";

export const LKG_FRESH_MS = 60 * 60 * 1_000;
export const LKG_STALE_MS = 24 * 60 * 60 * 1_000;
export const LKG_STATES = Object.freeze(["fresh", "stale", "unavailable", "invalid"]);
export const CATALOG_LKG_DIR =
  process.env.MODEL_ROUTER_CATALOG_LKG_DIR || path.join(STATE_DIR, "catalog-lkg");

function safeProviderId(providerId) {
  const value = String(providerId || "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new Error(`Invalid provider id for catalog LKG: ${value || "empty"}`);
  }
  return value;
}

export function providerLkgPath(providerId) {
  return path.join(CATALOG_LKG_DIR, `${safeProviderId(providerId)}.json`);
}

function canonicalModels(models) {
  if (!Array.isArray(models)) throw new Error("Catalog LKG models must be an array.");
  return [...new Set(
    models
      .map((model) => String(model || "").trim())
      .filter(Boolean),
  )].sort();
}

function timestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Catalog LKG fetchedAt must be a valid timestamp.");
  return date;
}

function nowMs(options) {
  if (typeof options === "number") return options;
  if (typeof options === "function") return options();
  return options?.now === undefined ? Date.now() : options.now;
}

export function stateForAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "invalid";
  if (ageMs <= LKG_FRESH_MS) return "fresh";
  if (ageMs <= LKG_STALE_MS) return "stale";
  return "unavailable";
}

function invalidRecord() {
  return { models: [], fetchedAt: null, ageMs: null, state: "invalid" };
}

export function unavailableLkg(record, options = {}) {
  if (!record) return { models: [], fetchedAt: null, ageMs: null, state: "unavailable" };
  if (record.state === "invalid") return { ...record };
  const fetchedAt = timestamp(record.fetchedAt);
  const ageMs = Math.max(0, Number(nowMs(options)) - fetchedAt.getTime());
  return {
    models: canonicalModels(record.models),
    fetchedAt: fetchedAt.toISOString(),
    ageMs,
    state: "unavailable",
  };
}

export function readProviderLkg(providerId, options = {}) {
  const target = providerLkgPath(providerId);
  if (!existsSync(target)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(target, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalidRecord();
    const models = canonicalModels(parsed.models);
    const fetchedAt = timestamp(parsed.fetchedAt);
    const ageMs = Math.max(0, Number(nowMs(options)) - fetchedAt.getTime());
    return {
      models,
      fetchedAt: fetchedAt.toISOString(),
      ageMs,
      state: stateForAge(ageMs),
    };
  } catch {
    return invalidRecord();
  }
}

export function writeProviderLkg(providerId, record) {
  const target = providerLkgPath(providerId);
  const models = canonicalModels(record?.models);
  const fetchedAt = timestamp(record?.fetchedAt).toISOString();
  mkdirSync(CATALOG_LKG_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp.${process.pid}`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ version: 1, provider: safeProviderId(providerId), models, fetchedAt }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  try {
    protectPrivateFile(temporary);
    renameSync(temporary, target);
    protectPrivateFile(target);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}
