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

### Subagent architecture: many models, one task, agents that talk to each other

Every routed model gets its own agent profile, so Codex can spawn subagents
with completely different models — a GPT parent handing bounded work to a
DeepSeek V4 Flash subagent, a Kimi K3 subagent for frontend, or a free model
for trivial chores.

Beyond the in-app subagents (which share the parent thread natively), the
router can fan out **any task to any number of models at once** as CLI agents:

```
┌────────────┐   run-agents    ┌─────────────────────────┐
│  main agent│───────────────▶ │  opencode-zen/laguna    │──▶ file + log
│ (Codex app)│   --models a,b  │  opencode-go/minimax-m3 │──▶ file + log
└─────┬──────┘                 │  opencode-go/deepseek   │──▶ file + log
      │                        └───────────┬─────────────┘
      └────────── mailbox (bin/agent-msg) ──┘
         agents read & send messages to each other and to you
```

Each agent works in its own directory, writes its own output, and
communicates through a shared mailbox — they can ask each other for reviews,
hand off files, or report progress. The main agent can join the same mailbox
and coordinate the whole swarm. Verified end-to-end: two free models greeted
each other, replied, and recorded the exchange.

### Get it running in one line

**Terminal (macOS/Linux):**

```bash
curl -fsSL https://raw.githubusercontent.com/DrOetker747/codex-model-router/main/install.sh | sh
```

**Windows PowerShell:**

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
irm https://raw.githubusercontent.com/DrOetker747/codex-model-router/main/install.ps1 | iex
```

**Or just paste this into Codex, opencode, or any coding agent:**

> Install the Codex Model Router from https://github.com/DrOetker747/codex-model-router
> using the official install script, configure my opencode Go API key (ask me
> for it), refresh the model catalog, and make sure the router service is
> running and Codex is pointed at it. Preserve my native GPT models, my
> ChatGPT login, my MCP servers and my skills. Do not publish or commit any
> API keys. Then tell me how to pick DeepSeek or the free models in the Codex
> picker and how to run several models on one task at once.

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

**Agents can talk to each other.** Every run creates a shared mailbox at
`<outDir>/mailbox/` and each agent gets its own id plus the exact commands to
read and send messages. Agents coordinate by calling:

```bash
~/.local/share/codex-router/bin/agent-msg send --mailbox DIR --from MY_ID --to OTHER_ID --message "text"
~/.local/share/codex-router/bin/agent-msg read --mailbox DIR --as MY_ID
```

The main Codex agent can join the same mailbox (pass `--mailbox DIR` to reuse
a mailbox across runs), post instructions, and collect answers — verified
end-to-end with two agents exchanging greetings and replies. In the Codex
desktop app itself, native subagents already communicate with the main agent
through the shared thread.

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

## FAQ

**Can I use DeepSeek in Codex Desktop / ChatGPT app?**
Yes. Codex Model Router adds DeepSeek V4 Flash, DeepSeek V4 Pro and a free
DeepSeek V4 Flash tier to the native Codex model picker, next to your GPT
models. Everything runs through a local gateway on `127.0.0.1` — nothing is
sent to a third-party cloud proxy.

**How do I use free models in Codex?**
The router ships with 8 verified free models from OpenCode Zen (Big Pickle,
DeepSeek V4 Flash Free, MiMo-V2.5 Free, Laguna S 2.1 Free, Ling-3.0-flash
Free, LongCat-2.0 Free, North Mini Code Free, Nemotron 3 Ultra Free). Pick
them in the Codex model picker like any other model; they cost $0.

**Can I keep my ChatGPT subscription while using external models?**
Yes — that is the core design. Native GPT requests are forwarded through your
own authenticated ChatGPT session, so GPT-5.6 Sol / Luna / Terra keep using
your subscription. External models use your opencode Go key or your own API
keys.

**What happens when my opencode Go quota runs out?**
The router automatically rotates to the next configured API key (up to 5 per
provider) within seconds, marks the exhausted key down for 10 minutes and
retries the request. No more "quota exceeded" walls.

**How do I run several models on the same task at once?**
`./bin/run-agents --task "..." --models "model-a,model-b,model-c"` spawns
them in parallel as CLI agents, each with its own working directory, logs and
output files. Agents can coordinate through a shared mailbox
(`bin/agent-msg`).

**Do I need to open any ports or expose my machine?**
No. The router listens only on `127.0.0.1` (loopback). No inbound network
exposure, no cloud proxy, no telemetry.

**Is my API key safe?**
Keys are stored in protected local files (mode 0600) or macOS Keychain and
are only sent to the provider you configured. This repository contains no
secrets and the install never publishes any.

**Does it work on Windows / Linux?**
Yes. Native installers exist for macOS/Linux (`install.sh`) and Windows
(`install.ps1`), plus a menu-bar/tray companion app.

**Which models are supported?**
Native GPT family, DeepSeek, Kimi, Qwen, GLM, MiniMax, Grok, MiMo, HY3,
Anthropic API models, xAI, z.ai, OpenRouter, Groq, Mistral, Cerebras, NVIDIA
NIM, Hugging Face, Gemini — plus the 8 free OpenCode Zen models.

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
