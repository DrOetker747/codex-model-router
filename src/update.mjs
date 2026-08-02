import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readInstallManifest } from "./install-manifest.mjs";
import { SOURCE_ROOT, TARGET } from "./paths.mjs";

function git(args, options = {}) {
  const output = execFileSync("git", ["-C", SOURCE_ROOT, ...args], {
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  return typeof output === "string" ? output.trim() : "";
}

function requireManagedCheckout() {
  if (!existsSync(path.join(SOURCE_ROOT, ".git"))) {
    throw new Error(
      "This release is not a Git checkout. Re-run the installation command to upgrade it.",
    );
  }
  if (git(["status", "--porcelain"])) {
    throw new Error("The checkout has local changes; refusing to replace them during update.");
  }
  const origin = git(["remote", "get-url", "origin"]);
  const configured = process.env.CODEX_ROUTER_REPOSITORY_URL;
  const allowed = new Set([
    configured,
    "https://github.com/duolahypercho/codex-router",
    "https://github.com/duolahypercho/codex-router.git",
    "git@github.com:duolahypercho/codex-router.git",
  ].filter(Boolean));
  if (!allowed.has(origin)) {
    throw new Error(`The origin remote is not a recognized Codex Router repository: ${origin}`);
  }
}

export function currentCheckoutInstaller(platform = process.platform, target = TARGET) {
  return platform === "win32"
    ? {
        command: "powershell.exe",
        args: [
          "-NoLogo",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(SOURCE_ROOT, "install.ps1"),
          "-CheckoutInstall",
          "-Target",
          target,
        ],
      }
    : { command: path.join(SOURCE_ROOT, "bin", "install"), args: [] };
}

export function updateStrategy(aheadBy, behindBy) {
  if (behindBy <= 0) return "current";
  return aheadBy > 0 ? "rebase" : "fast-forward";
}

function installCurrentCheckout() {
  const installer = currentCheckoutInstaller();
  const result = spawnSync(installer.command, installer.args, {
    cwd: SOURCE_ROOT,
    stdio: "inherit",
    env: { ...process.env, MODEL_ROUTER_TARGET: TARGET },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Installer exited with status ${result.status}.`);
  }
}

function syncAutoModels() {
  const result = spawnSync(process.execPath, [
    path.join(SOURCE_ROOT, "src", "sync-auto-models.mjs"),
  ], {
    cwd: SOURCE_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, MODEL_ROUTER_TARGET: TARGET },
  });
  if (result.error || result.status !== 0) return false;
  try {
    const payload = JSON.parse(result.stdout || "{}");
    return payload.results?.some((entry) => entry.changed) || false;
  } catch {
    return false;
  }
}

function revisionExists(revision) {
  try {
    git(["cat-file", "-e", `${revision}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function restoreRevision(revision) {
  git(["switch", "--detach", revision], { inherit: true });
  installCurrentCheckout();
}

export function checkForUpdate() {
  requireManagedCheckout();
  git(["fetch", "--quiet", "origin", "main"]);
  const current = git(["rev-parse", "HEAD"]);
  const available = git(["rev-parse", "origin/main"]);
  const aheadBy = Number(git(["rev-list", "--count", "origin/main..HEAD"]));
  const behindBy = Number(git(["rev-list", "--count", "HEAD..origin/main"]));
  const strategy = updateStrategy(aheadBy, behindBy);
  return {
    current,
    available,
    aheadBy,
    behindBy,
    strategy,
    updateAvailable: strategy !== "current",
  };
}

export function installationNeedsRefresh(manifest, revision) {
  return manifest?.current?.commit !== revision;
}

export function updateCheckout() {
  const status = checkForUpdate();
  if (!status.updateAvailable) {
    const modelsSynced = syncAutoModels();
    if (!installationNeedsRefresh(readInstallManifest(), status.current) && !modelsSynced) {
      return { ...status, updated: false, reinstalled: false, modelsSynced };
    }
    installCurrentCheckout();
    return { ...status, updated: false, reinstalled: true, modelsSynced };
  }
  let branch = git(["branch", "--show-current"]);
  if (!branch) {
    git(["switch", "main"], { inherit: true });
    branch = "main";
  }
  if (branch !== "main") {
    throw new Error("Updates require the managed checkout to be on its main branch.");
  }
  git(["update-ref", "refs/codex-router/rollback", status.current]);
  if (status.strategy === "rebase") {
    try {
      git(["rebase", status.available], { inherit: true });
    } catch (error) {
      try {
        git(["rebase", "--abort"], { inherit: true });
      } catch {
        // Git reports the original conflict below; the clean-checkout guard
        // prevents an unrelated worktree from reaching this path.
      }
      throw new Error(
        "Update conflicts with the local provider extension; the previous source remains active.",
        { cause: error },
      );
    }
  } else {
    git(["merge", "--ff-only", status.available], { inherit: true });
  }
  try {
    installCurrentCheckout();
  } catch (error) {
    try {
      restoreRevision(status.current);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        `Update failed and automatic rollback also failed. The previous commit is ${status.current}.`,
      );
    }
    throw new Error(
      `Update failed; Codex Router was restored to ${status.current.slice(0, 12)}.`,
      { cause: error },
    );
  }
  return { ...status, updated: true, reinstalled: true };
}

export function rollbackCheckout() {
  requireManagedCheckout();
  const current = git(["rev-parse", "HEAD"]);
  let target;
  try {
    target = git(["rev-parse", "refs/codex-router/rollback"]);
  } catch {
    target = readInstallManifest()?.history?.find((entry) => entry.commit)?.commit;
  }
  if (!target || !revisionExists(target)) {
    throw new Error("No locally cached working revision is available to roll back to.");
  }
  if (target === current) throw new Error("The rollback revision is already installed.");
  git(["update-ref", "refs/codex-router/rollback", current]);
  try {
    restoreRevision(target);
  } catch (error) {
    try {
      restoreRevision(current);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        `Rollback failed and the current revision could not be restored (${current}).`,
      );
    }
    throw error;
  }
  return { rolledBack: true, from: current, to: target };
}

async function main() {
  const command = process.argv[2] || "update";
  const result = command === "check"
    ? checkForUpdate()
    : command === "update"
      ? updateCheckout()
      : command === "rollback"
        ? rollbackCheckout()
        : undefined;
  if (!result) {
    console.error("Usage: update.mjs check|update|rollback");
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
