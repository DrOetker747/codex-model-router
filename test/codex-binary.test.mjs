import assert from "node:assert/strict";
import test from "node:test";

import { codexSpawnTarget, preferSpawnablePath } from "../src/codex-binary.mjs";

// Reported in #46: `where.exe codex` on an npm global install lists the
// extensionless POSIX shim before the batch shim. Node cannot spawn the former
// without a shell, so taking the first line made every Codex probe throw
// ENOENT. That was then read as "signed out", which stripped every native
// model from the catalog with no error surfaced.
const NPM_WHERE_OUTPUT = [
  "C:\\Users\\krist\\AppData\\Roaming\\npm\\codex",
  "C:\\Users\\krist\\AppData\\Roaming\\npm\\codex.cmd",
  "",
];

test("prefers the spawnable shim over the extensionless one on Windows", () => {
  assert.equal(
    preferSpawnablePath(NPM_WHERE_OUTPUT, "win32"),
    "C:\\Users\\krist\\AppData\\Roaming\\npm\\codex.cmd",
  );
});

test("prefers a real executable over a batch shim when both are on PATH", () => {
  assert.equal(
    preferSpawnablePath(["C:\\shim\\codex.cmd", "C:\\real\\codex.exe"], "win32"),
    "C:\\real\\codex.exe",
  );
});

test("keeps the first match on POSIX, where every entry is spawnable", () => {
  assert.equal(
    preferSpawnablePath(["/opt/homebrew/bin/codex", "/usr/local/bin/codex"], "darwin"),
    "/opt/homebrew/bin/codex",
  );
});

test("falls back to the first entry when nothing looks spawnable", () => {
  assert.equal(preferSpawnablePath(["C:\\odd\\codex"], "win32"), "C:\\odd\\codex");
});

test("ignores blank lines in finder output", () => {
  assert.equal(
    preferSpawnablePath(["", "   ", "/opt/homebrew/bin/codex"], "darwin"),
    "/opt/homebrew/bin/codex",
  );
});

test("returns undefined for empty finder output", () => {
  assert.equal(preferSpawnablePath([], "win32"), undefined);
  assert.equal(preferSpawnablePath(["", "   "], "darwin"), undefined);
});

test("a Windows batch shim runs through a shell with its path quoted", () => {
  // cmd.exe splits on spaces and Codex is routinely installed under a profile
  // directory that contains them.
  const target = codexSpawnTarget("C:\\Program Files\\npm\\codex.cmd", "win32");
  assert.equal(target.command, '"C:\\Program Files\\npm\\codex.cmd"');
  assert.equal(target.options.shell, true);
});

test("a Windows .exe is spawned directly, without a shell", () => {
  const target = codexSpawnTarget("C:\\Programs\\Codex\\codex.exe", "win32");
  assert.equal(target.command, "C:\\Programs\\Codex\\codex.exe");
  assert.equal(target.options.shell, undefined);
});

test("a POSIX binary never gets a shell, even if it ends in .cmd", () => {
  assert.equal(codexSpawnTarget("/opt/homebrew/bin/codex", "darwin").options.shell, undefined);
  assert.equal(codexSpawnTarget("/weird/path/codex.cmd", "darwin").options.shell, undefined);
});
