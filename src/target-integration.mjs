import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { NATIVE_CATALOG_PATH, SOURCE_ROOT } from "./paths.mjs";

function run(script, args = []) {
  execFileSync(process.execPath, [path.join(SOURCE_ROOT, "src", script), ...args], {
    cwd: SOURCE_ROOT,
    env: process.env,
    stdio: ["ignore", "ignore", "inherit"],
  });
}

export function targetCli(command) {
  return `./bin/${command}`;
}

export function targetPickerName() {
  return "Codex";
}

export function refreshTargetPickerIfInstalled() {
  if (!existsSync(NATIVE_CATALOG_PATH)) return false;
  run("catalog.mjs");
  return true;
}
