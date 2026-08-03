import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { waitForRouterHealth } from "../src/router-health.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function waitForRouter(processHandle, port) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.status) return;
    } catch {
      // The child is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  processHandle.kill("SIGTERM");
  throw new Error("router did not start");
}

test("router health waits through a transient startup failure", async () => {
  let requests = 0;
  const health = await waitForRouterHealth({
    target: "codex",
    timeoutMs: 100,
    intervalMs: 1,
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) throw new Error("connection refused");
      return new Response(JSON.stringify({ service: "codex-router", version: "test" }), {
        status: 200,
      });
    },
  });

  assert.equal(requests, 2);
  assert.equal(health.ok, true);
  assert.equal(health.payload.version, "test");
});

test("router health rejects a different service on the configured port", async () => {
  const health = await waitForRouterHealth({
    target: "codex",
    timeoutMs: 0,
    fetchImpl: async () => new Response(JSON.stringify({ service: "another-router" })),
  });

  assert.equal(health.ok, false);
  assert.match(health.error, /different service/);
});

test("router model catalog exposes its generation timestamp", async () => {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "router-catalog-health-"));
  const catalogPath = path.join(stateDir, "merged-models.json");
  const port = 46_500 + Math.floor(Math.random() * 500);
  const callerKey = "test-router-caller-capability-with-sufficient-length";
  writeFileSync(
    catalogPath,
    `${JSON.stringify({
      catalogUpdatedAt: "2026-08-03T12:00:00.000Z",
      models: [{ slug: "gpt-5.6-sol", visibility: "list" }],
    })}\n`,
  );
  const child = spawn(process.execPath, [path.join(root, "src", "router.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      CODEX_ROUTER_PORT: String(port),
      CODEX_ROUTER_CATALOG: catalogPath,
      CODEX_ROUTER_INTERNAL_KEY: "test-router-internal-key-with-sufficient-length",
      CODEX_ROUTER_CALLER_KEY: callerKey,
      CODEX_ROUTER_QUIET: "1",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await waitForRouter(child, port);
    const response = await fetch(
      `http://127.0.0.1:${port}/_codex-router/${callerKey}/v1/models`,
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.catalogUpdatedAt, "2026-08-03T12:00:00.000Z");
  } finally {
    child.kill("SIGTERM");
    rmSync(stateDir, { recursive: true, force: true });
  }
});
