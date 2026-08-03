import { mkdirSync } from "node:fs";
import path from "node:path";

import lockfile from "proper-lockfile";

import { STATE_DIR } from "./paths.mjs";

async function withFileLock(
  target,
  operation,
  {
    waitMs,
    retryMs,
    staleMs,
    lockfilePath = `${target}.lock`,
    overlapMessage,
  },
) {
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const retries = Math.max(0, Math.ceil(waitMs / retryMs) - 1);
  let release;
  try {
    release = await lockfile.lock(target, {
      realpath: false,
      lockfilePath,
      stale: staleMs,
      update: Math.min(10_000, staleMs / 2),
      retries: {
        retries,
        factor: 1,
        minTimeout: retryMs,
        maxTimeout: retryMs,
        randomize: false,
      },
    });
  } catch (error) {
    if (error?.code === "ELOCKED") {
      throw new Error(overlapMessage, { cause: error });
    }
    throw error;
  }

  try {
    return await operation();
  } finally {
    await release();
  }
}

export async function withServiceOperationLock(
  operation,
  {
    stateDir = STATE_DIR,
    waitMs = 15_000,
    retryMs = 100,
    staleMs = 90_000,
  } = {},
) {
  const target = path.join(stateDir, "service-operation");
  return withFileLock(target, operation, {
    waitMs,
    retryMs,
    staleMs,
    overlapMessage: "Another background-service operation is still running; retry shortly.",
  });
}

export async function withCatalogSingleFlight(
  lockPath,
  operation,
  { waitMs = 0, retryMs = 25, staleMs = 90_000 } = {},
) {
  if (!lockPath || typeof operation !== "function") {
    throw new TypeError("withCatalogSingleFlight requires a lock path and an operation.");
  }
  return withFileLock(lockPath, operation, {
    waitMs,
    retryMs,
    staleMs,
    overlapMessage: "The catalog sync is already running; retry shortly.",
  });
}
