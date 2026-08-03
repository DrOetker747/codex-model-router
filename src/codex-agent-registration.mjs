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
import { CODEX_HOME, CONFIG_PATH } from "./paths.mjs";

export const EXTERNAL_AGENT_REGISTRATION_START = "# BEGIN codex-router-agents-managed";
export const EXTERNAL_AGENT_REGISTRATION_END = "# END codex-router-agents-managed";

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function removeExternalAgentRegistrationBlock(contents) {
  const start = escapeRegex(EXTERNAL_AGENT_REGISTRATION_START);
  const end = escapeRegex(EXTERNAL_AGENT_REGISTRATION_END);
  return String(contents)
    .replace(new RegExp(`(?:^|\\n)${start}\\n[\\s\\S]*?\\n${end}(?:\\n|$)`, "g"), "\n")
    .replace(/^\s+|\s+$/g, "");
}

export function externalAgentRegistrationBlock(contents) {
  const start = escapeRegex(EXTERNAL_AGENT_REGISTRATION_START);
  const end = escapeRegex(EXTERNAL_AGENT_REGISTRATION_END);
  return String(contents).match(
    new RegExp(`${start}\\n[\\s\\S]*?\\n${end}`),
  )?.[0];
}

function validAgentName(value) {
  const name = String(value || "");
  if (!/^[a-z0-9_]+$/.test(name) || name === "root") {
    throw new Error(`Invalid external Codex agent name: ${name || "<empty>"}`);
  }
  return name;
}

function relativeConfigFile(profile, codexHome) {
  const relative = path.relative(codexHome, String(profile.path || ""));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`External Codex agent file must be inside ${codexHome}.`);
  }
  return relative.split(path.sep).join("/");
}

function atomicWrite(target, contents) {
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp.${process.pid}`;
  try {
    writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600 });
    protectPrivateFile(temporary);
    renameSync(temporary, target);
    protectPrivateFile(target);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

export function syncExternalAgentRegistrations(
  profiles,
  { configPath = CONFIG_PATH, codexHome = CODEX_HOME } = {},
) {
  if (!Array.isArray(profiles)) throw new Error("External Codex agent profiles must be an array.");
  const current = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const cleaned = removeExternalAgentRegistrationBlock(current);
  const registered = [];
  const skipped = [];
  const rows = [];

  for (const profile of profiles.filter((item) => item?.managed !== false)) {
    const agentName = validAgentName(profile.agentName);
    const tablePattern = new RegExp(`^\\s*\\[agents\\.${escapeRegex(agentName)}\\]\\s*$`, "m");
    if (tablePattern.test(cleaned)) {
      skipped.push(agentName);
      continue;
    }
    const displayName = String(profile.displayName || profile.slug || agentName).trim();
    rows.push(
      `[agents.${agentName}]`,
      `description = ${JSON.stringify(`${displayName} routed through Codex Model Router.`)}`,
      `config_file = ${JSON.stringify(relativeConfigFile(profile, codexHome))}`,
      "",
    );
    registered.push(agentName);
  }

  const next = [
    cleaned,
    ...(rows.length
      ? [EXTERNAL_AGENT_REGISTRATION_START, ...rows, EXTERNAL_AGENT_REGISTRATION_END]
      : []),
  ].filter(Boolean).join("\n\n").trim();
  atomicWrite(configPath, `${next}${next ? "\n" : ""}`);
  return { registered, skipped };
}
