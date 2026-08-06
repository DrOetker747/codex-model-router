import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { pipeResponse } from "../src/http-utils.mjs";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

// A client that hangs up mid-stream makes the response emit "close" without
// ever emitting "finish" or "error". pipeResponse must still settle, otherwise
// the router's in-flight counter never releases the request.
test("pipeResponse settles when the client disconnects mid-stream", async () => {
  let settled = false;
  let pipeError;

  const server = http.createServer(async (request, response) => {
    const upstream = {
      status: 200,
      headers: new Map([["content-type", "text/event-stream"]]),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: first\n\n"));
          // Never closed: the stream stays open like a live SSE upstream.
        },
      }),
    };
    try {
      await pipeResponse(upstream, response, new Set());
    } catch (error) {
      pipeError = error;
    }
    settled = true;
  });

  const port = await listen(server);

  await new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/" }, (response) => {
      response.once("data", () => {
        request.destroy();
        resolve();
      });
    });
    request.once("error", () => resolve());
    request.end();
  });

  const deadline = Date.now() + 2_000;
  while (!settled && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  await close(server);
  assert.equal(settled, true, "pipeResponse never settled after client disconnect");
  assert.equal(pipeError, undefined);
});

test("pipeResponse resolves after a complete response", async () => {
  let settled = false;

  const server = http.createServer(async (request, response) => {
    const upstream = {
      status: 200,
      headers: new Map([["content-type", "text/plain"]]),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("done"));
          controller.close();
        },
      }),
    };
    await pipeResponse(upstream, response, new Set());
    settled = true;
  });

  const port = await listen(server);
  const body = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());

  await close(server);
  assert.equal(body, "done");
  assert.equal(settled, true);
});
