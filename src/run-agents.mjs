import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MODEL_BY_SLUG } from "./model-registry.mjs";
import { SOURCE_ROOT } from "./paths.mjs";

const DESKTOP_CODEX =
  "/Applications/ChatGPT.app/Contents/Resources/codex";

function findCodexBinary() {
  if (existsSync(DESKTOP_CODEX)) return DESKTOP_CODEX;
  for (const name of ["codex", "codex-cli"]) {
    for (const directory of (process.env.PATH || "").split(":")) {
      if (!directory) continue;
      const candidate = path.join(directory, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(
    "No Codex binary found: checked the ChatGPT desktop app bundle and PATH. Install the Codex CLI or reopen the desktop app.",
  );
}

function safeIdentifier(value, separator) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, "g"), "");
}

function parseArguments(argv) {
  const options = {
    models: [],
    task: "",
    workdir: process.cwd(),
    outDir: "",
    filePrefix: "",
    effort: "",
    concurrency: 0,
    timeoutMs: 0,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${argument} requires a value`);
      index += 1;
      return next;
    };
    switch (argument) {
      case "--task":
        options.task = value();
        break;
      case "--models":
        options.models = value()
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
        break;
      case "--workdir":
        options.workdir = value();
        break;
      case "--out-dir":
        options.outDir = value();
        break;
      case "--file-prefix":
        options.filePrefix = value();
        break;
      case "--effort":
        options.effort = value();
        break;
      case "--concurrency":
        options.concurrency = Number(value());
        break;
      case "--timeout":
        options.timeoutMs = Number(value()) * 1000;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (!options.task) throw new Error("--task is required.");
  if (options.models.length === 0) throw new Error("--models is required.");
  if (!existsSync(options.workdir)) {
    throw new Error(`Working directory does not exist: ${options.workdir}`);
  }
  if (options.concurrency < 0) throw new Error("--concurrency must be positive.");
  return options;
}

function agentPrompt(options, model, slug) {
  const parts = [];
  if (options.filePrefix) {
    const fileName = `${options.filePrefix}-${slug}.html`;
    parts.push(
      `Create the file ${JSON.stringify(fileName)} directly in the working directory ${JSON.stringify(options.workdir)}.`,
    );
  }
  parts.push(options.task);
  parts.push(
    "Do not modify unrelated files. Do not delete anything. At the end, briefly state what you created.",
  );
  return parts.join("\n\n");
}

function runAgent(options, binary, model, slug, outDir) {
  return new Promise((resolve) => {
    const label = safeIdentifier(slug, "-");
    const logPath = path.join(outDir, "logs", `${label}.log`);
    const finalPath = path.join(outDir, "logs", `${label}.final.txt`);
    const args = [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "-C",
      options.workdir,
      "-m",
      model,
      "-o",
      finalPath,
    ];
    if (options.effort) args.push("-c", `model_reasoning_effort=${options.effort}`);
    args.push(agentPrompt(options, model, slug));

    const startedAt = Date.now();
    const child = spawn(binary, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stream = [];
    child.stdout.on("data", (chunk) => stream.push(chunk));
    child.stderr.on("data", (chunk) => stream.push(chunk));
    const timer = options.timeoutMs
      ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMs)
      : null;
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({
        model,
        slug,
        ok: false,
        code: null,
        error: error.message,
        durationMs: Date.now() - startedAt,
        logPath,
        finalPath,
      });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const contents = Buffer.concat(stream).toString("utf8");
      writeFileSync(logPath, contents, { encoding: "utf8", mode: 0o644 });
      const finalMessage = existsSync(finalPath)
        ? readFileSync(finalPath, "utf8").trim().slice(0, 500)
        : "";
      resolve({
        model,
        slug,
        ok: code === 0,
        code,
        error: code === 0 ? undefined : "agent exited with an error",
        durationMs: Date.now() - startedAt,
        logPath,
        finalPath,
        finalMessage,
      });
    });
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const binary = findCodexBinary();
  const outDir = options.outDir || path.join(options.workdir, "agents-run");
  mkdirSync(path.join(outDir, "logs"), { recursive: true });

  const resolved = [];
  for (const model of options.models) {
    const entry = MODEL_BY_SLUG.get(model);
    if (!entry) {
      throw new Error(
        `Unknown model slug ${model}. Run ./bin/refresh-catalog for newly added models.`,
      );
    }
    resolved.push({ model, slug: safeIdentifier(model, "-") });
  }

  if (!options.json) {
    console.error(
      `[run-agents] ${resolved.length} agents via ${binary} -> ${outDir}`,
    );
  }
  const limit = options.concurrency || resolved.length;
  const results = [];
  let cursor = 0;
  const workers = [];
  for (let workerIndex = 0; workerIndex < Math.min(limit, resolved.length); workerIndex += 1) {
    workers.push(
      (async () => {
        for (;;) {
          const index = cursor;
          cursor += 1;
          if (index >= resolved.length) return;
          const { model, slug } = resolved[index];
          const result = await runAgent(options, binary, model, slug, outDir);
          results.push(result);
          if (options.json) {
            process.stdout.write(`${JSON.stringify({ event: "done", ...result })}\n`);
          } else {
            console.error(
              `[run-agents] ${result.ok ? "PASS" : "FAIL"} ${model} (${result.code ?? "err"}) in ${Math.round(result.durationMs / 1000)}s`,
            );
          }
        }
      })(),
    );
  }
  await Promise.all(workers);

  if (!options.json) {
    console.error(`[run-agents] ${results.filter((result) => result.ok).length}/${results.length} agents succeeded. Logs in ${outDir}/logs.`);
  }
  process.exitCode = results.every((result) => result.ok) ? 0 : 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`[run-agents] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

export { findCodexBinary, runAgent, agentPrompt, parseArguments, safeIdentifier };
