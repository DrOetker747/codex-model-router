import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  privateFileIsProtected,
  protectPrivateFile,
} from "./file-security.mjs";
import { CODEX_AGENTS_DIR } from "./paths.mjs";

export function safeIdentifier(value, separator) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, "g"), "");
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

export function routedAgentDefinition(model) {
  const slug = String(model?.slug || "").trim();
  if (!slug || !slug.includes("/")) {
    throw new Error(`Cannot create a routed agent for invalid model slug: ${slug || "<empty>"}`);
  }
  const fileStem = `router-model-${safeIdentifier(slug, "-")}`;
  const agentName = `router_${safeIdentifier(slug, "_")}`;
  const displayName = String(model.displayName || model.display_name || slug).trim();
  const contents = [
    "# Managed by Codex Router. Refresh the model catalog to update this file.",
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

export function syncRoutedCodexAgents(models, agentsDir = CODEX_AGENTS_DIR) {
  mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
  const written = [];
  for (const model of models) {
    const definition = routedAgentDefinition(model);
    const target = path.join(agentsDir, definition.fileName);
    const temporary = `${target}.tmp.${process.pid}`;
    writeFileSync(temporary, definition.contents, { encoding: "utf8", mode: 0o600 });
    protectPrivateFile(temporary);
    renameSync(temporary, target);
    protectPrivateFile(target);
    written.push({ model: model.slug, agent: definition.agentName, path: target });
  }
  return written;
}

export function routedCodexAgentStatus(models, agentsDir = CODEX_AGENTS_DIR) {
  const status = {
    expected: models.length,
    current: 0,
    missing: [],
    stale: [],
    unprotected: [],
  };
  for (const model of models) {
    const definition = routedAgentDefinition(model);
    const target = path.join(agentsDir, definition.fileName);
    if (!existsSync(target)) {
      status.missing.push(model.slug);
      continue;
    }
    let contents;
    try {
      contents = readFileSync(target, "utf8");
    } catch {
      status.stale.push(model.slug);
      continue;
    }
    if (contents !== definition.contents) {
      status.stale.push(model.slug);
      continue;
    }
    if (!privateFileIsProtected(target)) {
      status.unprotected.push(model.slug);
      continue;
    }
    status.current += 1;
  }
  return {
    ...status,
    ok: status.expected > 0 && status.current === status.expected,
  };
}
