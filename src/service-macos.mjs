import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  CODEX_HOME,
  LAUNCH_AGENT_PATH,
  LOG_PATH,
  PORTS,
  SERVICE_LABEL,
  SOURCE_ROOT,
  STATE_DIR,
  TARGET,
} from "./paths.mjs";

const command = process.argv[2] || "status";
const effectivePlatform = process.env.CODEX_ROUTER_SERVICE_PLATFORM || process.platform;
if (effectivePlatform !== "darwin" && !["render", "render-catalog-sync"].includes(command)) {
  throw new Error("The launchd service manager runs on macOS only.");
}
const userId = typeof process.getuid === "function" ? process.getuid() : 501;
const domain = `gui/${userId}`;
const service = `${domain}/${SERVICE_LABEL}`;
const CATALOG_SYNC_LABEL = "com.codexrouter.catalog-sync";
const catalogSyncService = `${domain}/${CATALOG_SYNC_LABEL}`;
const catalogSyncAgentPath = path.join(path.dirname(LAUNCH_AGENT_PATH), `${CATALOG_SYNC_LABEL}.plist`);
const catalogSyncTemplatePath = path.join(
  SOURCE_ROOT,
  "config",
  "launchd",
  `${CATALOG_SYNC_LABEL}.plist`,
);
const launchctl = "/bin/launchctl";
const launchctlRetryWait = new Int32Array(new SharedArrayBuffer(4));

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function environmentEntries() {
  const values = {
    MODEL_ROUTER_TARGET: TARGET,
    MODEL_ROUTER_STATE_DIR: STATE_DIR,
    MODEL_ROUTER_QUIET: "1",
    MODEL_ROUTER_GATEWAY_PORT: String(PORTS.gateway),
    MODEL_ROUTER_OAUTH_PORT: String(PORTS.oauth),
    MODEL_ROUTER_PORT: String(PORTS.router),
    MODEL_ROUTER_API_PORT: String(PORTS.api),
    CODEX_HOME,
    CODEX_ROUTER_STATE_DIR: STATE_DIR,
    KIMI_CODEX_STATE_DIR: STATE_DIR,
    CODEX_ROUTER_QUIET: "1",
    KIMI_PROXY_QUIET: "1",
    CODEX_ROUTER_GATEWAY_PORT: String(PORTS.gateway),
    CODEX_ROUTER_OAUTH_PORT: String(PORTS.oauth),
    CODEX_ROUTER_PORT: String(PORTS.router),
    CODEX_ROUTER_API_PORT: String(PORTS.api),
  };
  if (process.env.KIMI_CODE_HOME) values.KIMI_CODE_HOME = process.env.KIMI_CODE_HOME;
  return Object.entries(values)
    .map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`)
    .join("\n");
}

function plist() {
  const start = path.join(SOURCE_ROOT, "src", "start.mjs");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(SERVICE_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(start)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(SOURCE_ROOT)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${environmentEntries()}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Adaptive</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(LOG_PATH)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(LOG_PATH)}</string>
</dict>
</plist>
`;
}

function run(args, options = {}) {
  return execFileSync(launchctl, args, {
    encoding: "utf8",
    timeout: 15_000,
    stdio: options.quiet
      ? ["ignore", "ignore", "ignore"]
      : ["ignore", "pipe", "pipe"],
  });
}

function loaded(targetService = service) {
  try {
    const description = run(["print", targetService]);
    return /(?:state|path|type) =/.test(description) ? description : undefined;
  } catch {
    return undefined;
  }
}

function bootout(targetService = service) {
  const description = loaded(targetService);
  if (!description) return;
  try {
    run(["bootout", targetService], { quiet: true });
  } catch (error) {
    if (loaded(targetService)) throw error;
    return;
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!loaded(targetService)) return;
    Atomics.wait(launchctlRetryWait, 0, 0, 100);
  }
  if (loaded(targetService)) {
    throw new Error(`Timed out waiting for ${targetService} to stop.`);
  }
}

function writePlist() {
  mkdirSync(path.dirname(LAUNCH_AGENT_PATH), { recursive: true });
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${LAUNCH_AGENT_PATH}.tmp.${process.pid}`;
  writeFileSync(temporary, plist(), { encoding: "utf8", mode: 0o644 });
  chmodSync(temporary, 0o644);
  renameSync(temporary, LAUNCH_AGENT_PATH);
}

function catalogSyncPlist() {
  const values = {
    __NODE_PATH__: process.execPath,
    __SOURCE_ROOT__: SOURCE_ROOT,
    __MODEL_ROUTER_TARGET__: TARGET,
    __MODEL_ROUTER_STATE_DIR__: STATE_DIR,
    __LOG_PATH__: LOG_PATH,
  };
  return readFileSync(catalogSyncTemplatePath, "utf8").replace(
    /__(NODE_PATH|SOURCE_ROOT|MODEL_ROUTER_TARGET|MODEL_ROUTER_STATE_DIR|LOG_PATH)__/g,
    (token) => xml(values[token]),
  );
}

function writeCatalogSyncPlist() {
  mkdirSync(path.dirname(catalogSyncAgentPath), { recursive: true });
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${catalogSyncAgentPath}.tmp.${process.pid}`;
  writeFileSync(temporary, catalogSyncPlist(), { encoding: "utf8", mode: 0o644 });
  chmodSync(temporary, 0o644);
  renameSync(temporary, catalogSyncAgentPath);
}

function bootstrap(targetService = service, targetPath = LAUNCH_AGENT_PATH) {
  if (!existsSync(targetPath)) {
    throw new Error(`LaunchAgent is not installed at ${targetPath}.`);
  }
  run(["enable", targetService], { quiet: true });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      run(["bootstrap", domain, targetPath], { quiet: true });
      return;
    } catch (error) {
      const description = loaded(targetService);
      if (description && !/state = SIGTERM/.test(description)) return;
      if (error?.status !== 5 || attempt === 19) throw error;
      Atomics.wait(launchctlRetryWait, 0, 0, 100);
    }
  }
}

if (!new Set(["install", "uninstall", "start", "stop", "restart", "status", "render", "render-catalog-sync"]).has(command)) {
  console.error("Usage: service-macos.mjs install|uninstall|start|stop|restart|status|render|render-catalog-sync");
  process.exit(2);
}

if (command === "render") {
  process.stdout.write(plist());
} else if (command === "render-catalog-sync") {
  process.stdout.write(catalogSyncPlist());
} else if (command === "status") {
  const description = loaded();
  const catalogDescription = loaded(catalogSyncService);
  const installed = existsSync(LAUNCH_AGENT_PATH);
  const catalogSyncInstalled = existsSync(catalogSyncAgentPath);
  const isLoaded = Boolean(description) && installed;
  const catalogSyncLoaded = Boolean(catalogDescription) && catalogSyncInstalled;
  const state = isLoaded
    ? description?.match(/state = ([^\n]+)/)?.[1]?.trim() || "loaded"
    : "stopped";
  const catalogSyncState = catalogSyncLoaded
    ? catalogDescription?.match(/state = ([^\n]+)/)?.[1]?.trim() || "loaded"
    : "stopped";
  process.stdout.write(
    `${JSON.stringify({
      installed,
      loaded: isLoaded,
      state,
      catalogSyncInstalled,
      catalogSyncLoaded,
      catalogSyncState,
    })}\n`,
  );
} else if (command === "install") {
  bootout();
  bootout(catalogSyncService);
  writePlist();
  writeCatalogSyncPlist();
  bootstrap(service, LAUNCH_AGENT_PATH);
  bootstrap(catalogSyncService, catalogSyncAgentPath);
  process.stdout.write(`${JSON.stringify({ installed: true, path: LAUNCH_AGENT_PATH, catalogSyncPath: catalogSyncAgentPath })}\n`);
} else if (command === "uninstall") {
  bootout();
  bootout(catalogSyncService);
  try {
    run(["disable", service], { quiet: true });
  } catch {
    // Best effort.
  }
  try {
    run(["disable", catalogSyncService], { quiet: true });
  } catch {
    // Best effort.
  }
  if (existsSync(LAUNCH_AGENT_PATH)) unlinkSync(LAUNCH_AGENT_PATH);
  if (existsSync(catalogSyncAgentPath)) unlinkSync(catalogSyncAgentPath);
  process.stdout.write(`${JSON.stringify({ installed: false })}\n`);
} else if (command === "stop") {
  bootout();
  bootout(catalogSyncService);
  process.stdout.write(`${JSON.stringify({ state: "stopped" })}\n`);
} else if (command === "start") {
  if (!loaded()) bootstrap();
  if (!loaded(catalogSyncService)) bootstrap(catalogSyncService, catalogSyncAgentPath);
  process.stdout.write(`${JSON.stringify({ state: "running", catalogSync: "running" })}\n`);
} else if (command === "restart") {
  if (loaded()) {
    run(["kickstart", "-k", service], { quiet: true });
  } else {
    bootstrap();
  }
  if (loaded(catalogSyncService)) {
    run(["kickstart", "-k", catalogSyncService], { quiet: true });
  } else {
    bootstrap(catalogSyncService, catalogSyncAgentPath);
  }
  process.stdout.write(`${JSON.stringify({ state: "running", catalogSync: "running" })}\n`);
}
