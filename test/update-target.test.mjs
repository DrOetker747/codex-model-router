import assert from "node:assert/strict";
import test from "node:test";

import {
  currentCheckoutInstaller,
  installationNeedsRefresh,
  updateStrategy,
} from "../src/update.mjs";

test("checkout updates preserve the selected app target on every platform", () => {
  const windowsCodex = currentCheckoutInstaller("win32", "codex");
  assert.deepEqual(windowsCodex.args.slice(-2), ["-Target", "codex"]);

  const windowsCursor = currentCheckoutInstaller("win32", "cursor");
  assert.equal(windowsCursor.command, "powershell.exe");
  assert.deepEqual(windowsCursor.args.slice(-2), ["-Target", "cursor"]);

  const posixCursor = currentCheckoutInstaller("darwin", "cursor");
  assert.match(posixCursor.command, /bin[\\/]install$/);
  assert.deepEqual(posixCursor.args, []);
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

test("updates preserve a clean local provider extension", () => {
  assert.equal(updateStrategy(0, 0), "current");
  assert.equal(updateStrategy(2, 0), "current");
  assert.equal(updateStrategy(0, 3), "fast-forward");
  assert.equal(updateStrategy(2, 3), "rebase");
});
