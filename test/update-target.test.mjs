import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkForUpdate,
  currentCheckoutInstaller,
  installationNeedsRefresh,
  resolveCommand,
  trayRefreshRequired,
} from "../src/update.mjs";

test("checkout updates preserve the codex target on every platform", () => {
  const windowsCodex = currentCheckoutInstaller("win32", "codex");
  assert.equal(windowsCodex.command, "powershell.exe");
  assert.deepEqual(windowsCodex.args.slice(-2), ["-Target", "codex"]);

  const posixCodex = currentCheckoutInstaller("darwin", "codex");
  assert.match(posixCodex.command, /bin[\\/]install$/);
  assert.deepEqual(posixCodex.args, []);
});

test("a bare invocation updates and an explicit check stays read-only", () => {
  assert.equal(resolveCommand([]), resolveCommand(["update"]));
  assert.equal(resolveCommand(["check"]), checkForUpdate);
  assert.notEqual(resolveCommand(["check"]), resolveCommand(["update"]));
  assert.equal(resolveCommand(["nonsense"]), undefined);
});

test("an update reinstalls a revision pulled outside the updater", () => {
  assert.equal(installationNeedsRefresh(undefined, "new-revision"), true);
  assert.equal(
    installationNeedsRefresh({ current: { commit: "old-revision" } }, "new-revision"),
    true,
  );
  assert.equal(
    installationNeedsRefresh({ current: { commit: "new-revision" } }, "new-revision"),
    false,
  );
});

test("tray refresh is required when the checkout dist bundle exists", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tray-refresh-dist-"));
  try {
    mkdirSync(path.join(root, "dist", "Model Router.app"), { recursive: true });
    assert.equal(
      trayRefreshRequired({
        platform: "darwin",
        home: path.join(root, "home"),
        sourceRoot: root,
        registeredPath: "",
      }),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tray refresh is required when setup installed the home app bundle", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tray-refresh-home-"));
  try {
    mkdirSync(path.join(root, "home", "Applications", "Model Router.app"), {
      recursive: true,
    });
    assert.equal(
      trayRefreshRequired({
        platform: "darwin",
        home: path.join(root, "home"),
        sourceRoot: path.join(root, "router"),
        registeredPath: "",
      }),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tray refresh is required when only a registered bundle path exists", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tray-refresh-registered-"));
  try {
    const registered = path.join(root, "Model Router.app");
    mkdirSync(registered, { recursive: true });
    assert.equal(
      trayRefreshRequired({
        platform: "darwin",
        home: path.join(root, "home"),
        sourceRoot: path.join(root, "router"),
        registeredPath: registered,
      }),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tray refresh is skipped when no tray bundle exists", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tray-refresh-none-"));
  try {
    assert.equal(
      trayRefreshRequired({
        platform: "darwin",
        home: path.join(root, "home"),
        sourceRoot: path.join(root, "router"),
        registeredPath: "",
      }),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tray refresh is skipped on non-macOS platforms", () => {
  assert.equal(
    trayRefreshRequired({
      platform: "linux",
      home: os.homedir(),
      sourceRoot: path.resolve("."),
      registeredPath: path.resolve("."),
    }),
    false,
  );
});
