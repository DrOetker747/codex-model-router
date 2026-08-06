# Codex Model Router

**Plug every model into Codex Desktop — without losing your ChatGPT subscription.**

Codex Model Router is a local, private gateway that runs on your machine and gives
the Codex Desktop app (ChatGPT for Mac/Windows) access to dozens of external coding
models — **DeepSeek, Kimi, Qwen, GLM, MiniMax, Grok and more — including a growing
set of completely FREE models** — while keeping all your native GPT models (5.6 Sol,
5.6 Luna, 5.6 Terra …) working with your existing ChatGPT subscription.

It installs in minutes, runs as a background service on `127.0.0.1` (your keys never
leave your computer), and its model picker merges your native models with the
external catalog in one clean list.

> Built on [duolahypercho/codex-router](https://github.com/duolahypercho/codex-router) (MIT).
> This fork adds **multi-key quota rotation**, **free OpenCode Zen models**, a
> **duplicate-free model picker**, and a **parallel CLI agent runner**.

---

## Why you want this

| Problem | Solution |
|---|---|
| Codex Desktop only shows OpenAI GPT models | Full external catalog in the native picker |
| DeepSeek/Kimi/Qwen work great but not in Codex | One-click routing through a local gateway |
| One opencode subscription runs out of quota mid-task | **Automatic key rotation** across up to 5 keys |
| Free models exist on OpenCode Zen but nobody wired them up | **8 free models** included and verified |
| Subagents are OpenAI-only | Per-model agent profiles for every routed model |
| You don't trust cloud proxies with your keys | 100% local — the router runs on your machine |

---

## What you get

- **Native models stay native.** GPT-5.6 Sol / Luna / Terra, GPT-5.5, GPT-5.4 and the
  rest keep running on your ChatGPT subscription — the router forwards them through
  your authenticated session, so nothing about your plan changes.
- **External models in the same picker.** DeepSeek V4 Flash / Pro, Kimi K3, Qwen3.8
  Max, GLM 5.2, MiniMax M3, Grok 4.5, MiMo, HY3 … routed through your opencode Go
  subscription or your own API keys (Anthropic, DeepSeek, xAI, z.ai, Qwen, MiniMax,
  OpenRouter, Groq, Mistral, Cerebras, NVIDIA NIM, Hugging Face, Gemini and more).
- **FREE models that cost nothing.** Big Pickle, DeepSeek V4 Flash Free, MiMo-V2.5
  Free, Laguna S 2.1 Free, Ling-3.0-flash Free, LongCat-2.0 Free, North Mini Code
  Free and Nemotron 3 Ultra Free — served from OpenCode Zen at $0, verified working.
- **Quota failover (key rotation).** Stored up to 5 API keys per provider. When one
  subscription hits its limit (401/402/429), the router automatically marks it as
  exhausted, switches to the next key, retries the request and keeps working. Spent
  keys cool down for 10 minutes before being retried, and the state survives
  restarts. No more "quota exceeded" walls in the middle of a task.
- **One clean picker.** Protocol variants are deduplicated, so you never see the
  same model twice under different names.
- **Subagents for every model.** Each routed model gets its own agent profile —
  spawn a DeepSeek V4 Flash subagent from your native GPT-5.6 parent, for example.
  Every profile pins a reasoning effort its model supports, so batch spawning never
  fails on effort mismatches, and the in-app agent thread limit is raised so many
  subagents can run at once.
- **Up-to-date catalog.** `refresh-catalog` pulls the latest native and external
  model lists, so newly released models appear (and retired ones disappear).
- **Menu-bar companion (macOS).** Optional tray app shows router status, quota and
  provider state at a glance.

---

## How it works

```
┌─────────────────┐      ┌──────────────────────────────┐      ┌──────────────────┐
│  Codex Desktop  │─────▶│  Codex Model Router (local)  │─────▶│  chatgpt.com      │
│  (model picker) │      │  127.0.0.1:4102              │      │  (native models,  │
│                 │      │  ┌────────────────────────┐  │      │   your login)     │
│  native GPT     │      │  │ LiteLLM gateway        │  │      ├──────────────────┤
│  external       │      │  │ OpenCode Go / Zen      │  │─────▶│  opencode.ai      │
│  subagents      │      │  │ API forwarders (keys)  │  │      │  (external + FREE)│
└─────────────────┘      │  │ quota rotation engine  │  │      ├──────────────────┤
                         │  └────────────────────────┘  │      │  your API keys    │
                         └──────────────────────────────┘      └──────────────────┘
```

The Codex app sends every request to the local router. Native model requests are
forwarded to OpenAI with your session (your subscription covers them); external
requests are translated per model and sent to the right provider with the right key
— rotating automatically when one subscription is spent. Malformed upstream
streaming chunks are sanitized on the fly, so models like MiniMax stream to
completion instead of dropping the connection.

---

## Installation

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/DrOetker747/codex-model-router/main/install.sh | sh
```

Follow the prompts, enter your opencode Go API key (or any other provider key), and
the router takes care of the rest: Node dependencies, the LiteLLM gateway, the
background service, and the Codex configuration.

### Windows

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
irm https://raw.githubusercontent.com/DrOetker747/codex-model-router/main/install.ps1 | iex
```

### From a checkout

```bash
git clone https://github.com/DrOetker747/codex-model-router.git
cd codex-model-router
./install.sh --guided
```

### Requirements

- macOS / Windows / Linux
- Node.js 22.19+ (24 LTS recommended)
- `uv` or Python 3.10+ (for the LiteLLM gateway)
- Codex Desktop app (ChatGPT app) or the Codex CLI

---

## Parallel agent runner

Spawn any number of models **at the same time** as CLI agents — outside the
Codex panel, without touching your app session:

```bash
./bin/run-agents \
  --task "Create a constellation HTML page with your own style." \
  --models "opencode-zen/north-mini-code-free,opencode-go/minimax-m3,opencode-go/deepseek-v4-flash" \
  --workdir "/path/to/project" \
  --file-prefix "constellation" \
  --effort high \
  --concurrency 5
```

Every agent runs through the local router with its own model, gets its own
output file (`constellation-<model>.html`), and writes its log plus final
message to `<workdir>/agents-run/logs/`. Pass `--json` for machine-readable
progress, `--timeout N` (seconds) to bound each agent, and `--out-dir` to move
the results elsewhere. The runner auto-detects the Codex binary bundled with
the ChatGPT desktop app or the `codex` CLI.

**What CLI agents can and cannot use:**

| Available | Not available |
|---|---|
| Shell, files, apply_patch, planning, stdin | Desktop-app plugins (browser, sites, computer-use, canva, vercel …) |
| MCP servers from your `config.toml` | In-app model picker / subagent panel |
| Router models, key rotation, free models | OpenAI-native plugin runtimes |
| `request_plugin_install` (agent can ask for plugins) | — |

CLI agents share your `~/.codex` configuration — MCP servers, rules, skills —
so they behave like a normal Codex session, minus the desktop-only plugins.

---

## Managing keys

```bash
# Add up to 5 keys per provider — the router rotates between them automatically
./bin/provider-key opencode-go set --slot 1     # primary key
./bin/provider-key opencode-go set --slot 2     # second subscription
./bin/provider-key opencode-go set --slot 3     # third subscription

# Check what's configured
./bin/provider-key opencode-go status
# → opencode Go/Zen key is configured via protected file (...)
# → Key slots configured: 3 (slot 1, slot 2, slot 3). On quota exhaustion
#   the router rotates to the next slot.
```

Keys are stored as protected files (mode 0600) in the router state directory —
never in this repository, never sent anywhere except the provider you configured.

---

## Updating the model catalog

```bash
./bin/refresh-catalog
```

Fetches the latest native and external model lists, merges them, and refreshes the
per-model subagent profiles. Newly released models appear after you fully quit and
reopen Codex.

---

## Daily workflow

1. Pick **GPT-5.6 Sol** for architecture work (your subscription).
2. Hand visual/frontend tasks to **Kimi K3** or **Qwen3.8 Max**.
3. Use **DeepSeek V4 Flash** as a fast subagent for bounded tasks.
4. Let a **free model** (e.g. North Mini Code Free) handle trivial chores — at $0.
5. Fan out a creative brief to 5 free models + 2 paid models at once with
   `bin/run-agents`.
6. When a key runs out of quota, the router silently rotates to the next one.

---

## Security & privacy

- The router listens only on `127.0.0.1` — no cloud proxy, no telemetry.
- API keys live in protected local files / macOS Keychain; nothing is committed to
  this repository.
- Native traffic flows through your own ChatGPT session; external traffic goes
  directly to the provider you chose.
- Free OpenCode Zen models may use submitted data to improve models (North Mini,
  Nemotron, Big Pickle, DeepSeek Free and friends) — don't send confidential data
  through the free tier.

---

## Roadmap

- [x] Native + external merged model picker
- [x] Per-model subagent profiles with pinned reasoning effort
- [x] Multi-key quota rotation with automatic failover
- [x] Free OpenCode Zen models
- [x] Duplicate-free catalog
- [x] Parallel CLI agent runner
- [ ] Usage dashboards per key slot
- [ ] One-click model migration prompts on catalog refresh

---

## License

MIT — see [LICENSE](LICENSE). Based on
[duolahypercho/codex-router](https://github.com/duolahypercho/codex-router) (MIT),
which does the heavy lifting; this fork layers on key rotation, free models,
picker polish and the parallel agent runner.
