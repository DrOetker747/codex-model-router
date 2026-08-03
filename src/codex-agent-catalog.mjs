import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  privateFileIsProtected,
  protectPrivateFile,
} from "./file-security.mjs";
import { CODEX_AGENTS_DIR, STATE_DIR } from "./paths.mjs";
import { isCompatibleExternalSubagent } from "./model-registry.mjs";

export const MAX_SELECTED_EXTERNAL_PROFILES = 32;
export const MAX_EXTERNAL_AGENT_PROFILES = 64;
export const EXTERNAL_AGENT_SELECTION_PATH =
  process.env.MODEL_ROUTER_EXTERNAL_AGENT_SELECTION_PATH ||
  process.env.CODEX_ROUTER_EXTERNAL_AGENT_SELECTION_PATH ||
  path.join(STATE_DIR, "selected-external-agents.json");
export const VERIFIED_EXTERNAL_AGENT_RECORD_PATH =
  process.env.MODEL_ROUTER_VERIFIED_EXTERNAL_AGENT_RECORD_PATH ||
  process.env.CODEX_ROUTER_VERIFIED_EXTERNAL_AGENT_RECORD_PATH ||
  path.join(STATE_DIR, "verified-external-agents.json");

function safeIdentifier(value, separator) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, "g"), "");
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function canonicalProfileSlug(value) {
  const slug = typeof value === "string" ? value : "";
  if (
    !slug ||
    slug.trim() !== slug ||
    !/^[a-z0-9][a-z0-9._-]*\/[^\s]+$/.test(slug)
  ) {
    throw new Error(`External agent selection requires a canonical slug: ${String(value)}`);
  }
  return slug;
}

function normalizeSelectedProfiles(values) {
  if (!Array.isArray(values)) throw new Error("External agent selection must be an array.");
  const profiles = [...new Set(values.map(canonicalProfileSlug))].sort((left, right) =>
    left.localeCompare(right),
  );
  if (profiles.length > MAX_SELECTED_EXTERNAL_PROFILES) {
    throw new Error(
      `External agent selection exceeds the maximum of ${MAX_SELECTED_EXTERNAL_PROFILES} profiles.`,
    );
  }
  return profiles;
}

export function readSelectedExternalAgentProfiles(target = EXTERNAL_AGENT_SELECTION_PATH) {
  if (!existsSync(target)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(target, "utf8"));
  } catch (error) {
    throw new Error(
      `Invalid external agent selection ${target}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed?.version !== 1) {
    throw new Error(`Invalid external agent selection ${target}: version must be 1.`);
  }
  return normalizeSelectedProfiles(parsed.profiles || parsed.selectedProfiles || []);
}

export function writeSelectedExternalAgentProfiles(
  values,
  target = EXTERNAL_AGENT_SELECTION_PATH,
) {
  const profiles = normalizeSelectedProfiles(values);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp.${process.pid}`;
  try {
    writeFileSync(temporary, `${JSON.stringify({ version: 1, profiles }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    protectPrivateFile(temporary);
    renameSync(temporary, target);
    protectPrivateFile(target);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
  return profiles;
}

export function verifiedExternalAgentProfilesFromRecord(record) {
  if (record?.version !== 1 || !Array.isArray(record.records)) {
    throw new Error("Invalid external agent verification record.");
  }
  const profiles = record.records
    .filter(
      (item) =>
        item &&
        item.verified === true &&
        item.method === "meaningful-text-tool-call" &&
        typeof item.recordId === "string" &&
        item.recordId,
    )
    .map((item) => canonicalProfileSlug(item.slug));
  return new Set(profiles);
}

// This is intentionally read-only. A verification record must be produced by
// a separate protected meaningful text plus tool-call test, not by catalog
// metadata or by this rebuild operation.
export function readVerifiedExternalAgentProfiles(
  target = VERIFIED_EXTERNAL_AGENT_RECORD_PATH,
) {
  if (!existsSync(target)) return new Set();
  if (!privateFileIsProtected(target)) {
    throw new Error(`Refusing to read unprotected external agent verification record ${target}.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(target, "utf8"));
  } catch (error) {
    throw new Error(
      `Invalid external agent verification record ${target}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return verifiedExternalAgentProfilesFromRecord(parsed);
}

function catalogModels(catalog) {
  if (Array.isArray(catalog)) return catalog;
  if (Array.isArray(catalog?.models)) return catalog.models;
  if (Array.isArray(catalog?.profiles)) return catalog.profiles;
  return [];
}

function cloneProfile(profile) {
  return typeof structuredClone === "function"
    ? structuredClone(profile)
    : JSON.parse(JSON.stringify(profile));
}

function isNativeProfile(profile) {
  const slug = String(profile?.slug || profile?.model || profile?.id || "");
  return profile?.native === true ||
    profile?.provider === "openai" ||
    profile?.model_provider === "openai" ||
    !slug.includes("/");
}

export function preserveNativeAgentProfiles(existingCatalog) {
  const nativeProfiles = catalogModels(existingCatalog)
    .filter(isNativeProfile)
    .map(cloneProfile);
  return {
    profiles: nativeProfiles,
    nativeProfiles,
    externalProfiles: [],
  };
}

function managedFile(fileName) {
  return /^router-model-[a-z0-9-]+\.toml$/.test(fileName);
}

function sortedModels(models) {
  return [...models].sort((left, right) =>
    Number(left.priority ?? 999) - Number(right.priority ?? 999) ||
    String(left.slug).localeCompare(String(right.slug)),
  );
}

function verifiedProfileSet(values) {
  if (values instanceof Set) return new Set(values);
  if (values === undefined) return readVerifiedExternalAgentProfiles();
  return new Set(normalizeSelectedProfiles(values));
}

// Rebuild and doctor use this one bounded selection algorithm. It is based on
// the exact merged catalog exposed to the switcher.
export function selectedExternalSubagentModels({
  mergedCatalog,
  selectedProfiles,
} = {}) {
  const models = catalogModels(mergedCatalog);
  const selected = normalizeSelectedProfiles(
    selectedProfiles === undefined
      ? readSelectedExternalAgentProfiles()
      : selectedProfiles,
  );
  const selectedSet = new Set(selected);
  const compatible = models.filter((model) =>
    isCompatibleExternalSubagent(model, { model_provider: "codex-router", model: model.slug }),
  );
  const visible = compatible.filter(
    (model) => model.visibility !== "hide" && model.pickerVisibility !== "hide",
  );
  const bySlug = new Map(compatible.map((model) => [String(model.slug), model]));
  const explicitModels = sortedModels(selected.map((slug) => bySlug.get(slug)).filter(Boolean));
  const visibleModels = sortedModels(visible);
  return [
    ...explicitModels,
    ...visibleModels.filter((model) => !selectedSet.has(String(model.slug))),
  ].slice(0, MAX_EXTERNAL_AGENT_PROFILES);
}

export function routedAgentDefinition(model, status = "catalog-only") {
  const slug = String(model?.slug || "").trim();
  if (!slug || !slug.includes("/")) {
    throw new Error(`Cannot create a routed agent for invalid model slug: ${slug || "<empty>"}`);
  }
  const fileStem = `router-model-${safeIdentifier(slug, "-")}`;
  const agentName = `router_${safeIdentifier(slug, "_")}`;
  const displayName = String(model.displayName || model.display_name || slug).trim();
  const contents = [
    "# Managed by Codex Router. Refresh the model catalog to update this file.",
    `# Profile status: ${status}`,
    `name = ${tomlString(agentName)}`,
    `description = ${tomlString(`${displayName} agent routed through an authenticated Codex Router provider.`)}`,
    'model_provider = "codex-router"',
    `model = ${tomlString(slug)}`,
    "",
    'developer_instructions = """',
    "Complete the bounded task assigned by the parent agent.",
    "Respect repository instructions, keep changes surgical, and run relevant verification.",
    "Return a concise summary of work completed, checks run, and remaining risks.",
    '"""',
    "",
  ].join("\n");
  return { agentName, fileName: `${fileStem}.toml`, contents };
}

export function rebuildExternalSubagentProfiles({
  mergedCatalog,
  selectedProfiles,
  agentsDir = CODEX_AGENTS_DIR,
  verifiedProfiles,
} = {}) {
  const selected = normalizeSelectedProfiles(
    selectedProfiles === undefined
      ? readSelectedExternalAgentProfiles()
      : selectedProfiles,
  );
  const ordered = selectedExternalSubagentModels({
    mergedCatalog,
    selectedProfiles: selected,
  });
  const verifiedSet = verifiedProfileSet(verifiedProfiles);
  const desired = new Set(ordered.map((model) => routedAgentDefinition(model).fileName));

  mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
  for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !managedFile(entry.name) || desired.has(entry.name)) continue;
    const target = path.join(agentsDir, entry.name);
    let contents;
    try {
      contents = readFileSync(target, "utf8");
    } catch {
      continue;
    }
    if (contents.startsWith("# Managed by Codex Router.")) unlinkSync(target);
  }

  const externalProfiles = ordered.map((model) => {
    const status = verifiedSet.has(String(model.slug)) ? "verified" : "catalog-only";
    const definition = routedAgentDefinition(model, status);
    const target = path.join(agentsDir, definition.fileName);
    let managed = true;
    if (existsSync(target)) {
      let existing;
      try {
        existing = readFileSync(target, "utf8");
      } catch {
        managed = false;
      }
      if (existing !== undefined && !existing.startsWith("# Managed by Codex Router.")) {
        managed = false;
      }
    }
    if (managed) {
      const temporary = `${target}.tmp.${process.pid}`;
      try {
        writeFileSync(temporary, definition.contents, { encoding: "utf8", mode: 0o600 });
        protectPrivateFile(temporary);
        renameSync(temporary, target);
        protectPrivateFile(target);
      } catch (error) {
        if (existsSync(temporary)) unlinkSync(temporary);
        throw error;
      }
    }
    return {
      ...definition,
      slug: model.slug,
      displayName: model.display_name || model.displayName || model.slug,
      status,
      verification: status,
      managed,
      path: target,
    };
  });
  const nativeProfiles = Array.isArray(mergedCatalog?.nativeProfiles?.nativeProfiles)
    ? mergedCatalog.nativeProfiles.nativeProfiles.map(cloneProfile)
    : Array.isArray(mergedCatalog?.nativeProfiles)
      ? mergedCatalog.nativeProfiles.map(cloneProfile)
      : preserveNativeAgentProfiles(mergedCatalog).nativeProfiles;
  return {
    catalogUpdatedAt: mergedCatalog?.catalogUpdatedAt,
    profiles: [...nativeProfiles, ...externalProfiles],
    nativeProfiles,
    externalProfiles,
    selectedProfiles: selected,
  };
}

export function syncRoutedCodexAgents(models, agentsDir = CODEX_AGENTS_DIR) {
  mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
  const written = [];
  for (const model of models) {
    const definition = routedAgentDefinition(model);
    const target = path.join(agentsDir, definition.fileName);
    if (existsSync(target)) {
      let existing;
      try {
        existing = readFileSync(target, "utf8");
      } catch {
        throw new Error(`Refusing to replace user-owned agent ${target}.`);
      }
      if (!existing.startsWith("# Managed by Codex Router.")) {
        throw new Error(`Refusing to replace user-owned agent ${target}.`);
      }
    }
    const temporary = `${target}.tmp.${process.pid}`;
    try {
      writeFileSync(temporary, definition.contents, { encoding: "utf8", mode: 0o600 });
      protectPrivateFile(temporary);
      renameSync(temporary, target);
      protectPrivateFile(target);
    } catch (error) {
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
    written.push({ model: model.slug, agent: definition.agentName, path: target });
  }
  return written;
}

export function routedCodexAgentStatus(models, agentsDir = CODEX_AGENTS_DIR) {
  const verifiedProfiles = readVerifiedExternalAgentProfiles();
  const result = {
    expected: models.length,
    current: 0,
    missing: [],
    stale: [],
    unprotected: [],
  };
  for (const model of models) {
    const verificationStatus = verifiedProfiles.has(String(model.slug)) ? "verified" : "catalog-only";
    const definition = routedAgentDefinition(model, verificationStatus);
    const target = path.join(agentsDir, definition.fileName);
    if (!existsSync(target)) {
      result.missing.push(model.slug);
      continue;
    }
    let contents;
    try {
      contents = readFileSync(target, "utf8");
    } catch {
      result.stale.push(model.slug);
      continue;
    }
    if (contents !== definition.contents) {
      result.stale.push(model.slug);
      continue;
    }
    if (!privateFileIsProtected(target)) {
      result.unprotected.push(model.slug);
      continue;
    }
    result.current += 1;
  }
  return {
    ...result,
    ok: result.current === result.expected,
  };
}
