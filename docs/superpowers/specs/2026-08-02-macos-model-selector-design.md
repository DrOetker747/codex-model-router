# macOS Model Selector Design

## Goal

Extend the existing native Model Router menu-bar app with a safe, searchable
model selector. The Codex model picker remains short and SOTA-focused, while
the menu-bar app provides access to every configured OpenCode Go model and to
OpenCode's explicitly free models.

The selector changes the default for a new Codex task. It never changes a
running task.

## Scope

The first release supports three catalog views:

1. **SOTA**: favorites plus the models currently visible in the Codex picker.
2. **OpenCode Go**: every model returned by the Go catalog.
3. **Free**: only `big-pickle` and model IDs ending in `-free` from the public
   OpenCode Zen catalog.

Paid OpenCode Zen models are out of scope. The app must not list, enable, or
route them.

## Chosen approach

Extend `apps/macos/ModelRouterTray` instead of creating another app or a Codex
plugin.

- The existing tray already owns router health, provider setup, protected key
  entry, maintenance, and graceful Codex restart.
- A separate app would duplicate these controls and security boundaries.
- A plugin cannot reliably change the model used by a new desktop task.

The menu-bar popover remains the single control surface. No extra Dock icon is
added.

## User experience

The model selector appears near the top of the existing popover and follows
the approved high-fidelity mockup.

- Header: service status and current default model.
- Search: filters display name, model ID, provider, and family.
- Tabs: `SOTA`, `OpenCode Go`, and `Free`.
- Model row: name, provider badge, optional role badge, favorite button, and
  selection checkmark.
- Go view: models grouped by family such as Kimi, MiniMax, DeepSeek, Qwen,
  GLM, Grok, MiMo, and Hy.
- Free view: all verified free models in one compact list.
- Favorites are stored in `UserDefaults` and appear first in SOTA.

Selecting a model opens a confirmation with two actions:

- **Later**: save the model as the next-task default and leave Codex running.
- **Restart**: save the model, gracefully quit Codex, and reopen it.

The confirmation states that running tasks are unchanged. The app never force
quits Codex.

## Catalog and routing

### SOTA

The active router keeps the existing automatic SOTA policy:

- the two newest visible native OpenAI generations;
- the newest compatible generation for each OpenCode Go family or meaningful
  speed tier;
- older and cheaper Go models remain routable with picker visibility `hide`.

Known future updates such as Grok 4.6 replace the previous family version in
the Codex picker without deleting the previous route.

### OpenCode Go

The Go view reads all enabled OpenCode Go routes from the router control
snapshot, including models hidden from the Codex picker. The existing public
`https://opencode.ai/zen/go/v1/models` synchronization remains authoritative.

### OpenCode Free

Add a separate provider with these constraints:

- Provider ID: `opencode-free`
- Display name: `OpenCode Free`
- Base URL: `https://opencode.ai/zen/v1`
- Protocol: OpenAI-compatible Chat Completions
- Discovery source: `https://opencode.ai/zen/v1/models`
- Strict allow rule: `big-pickle` or an ID ending in `-free`
- Picker visibility: `hide` for every Free model

The current documented free set is:

- `big-pickle`
- `deepseek-v4-flash-free`
- `mimo-v2.5-free`
- `ling-3.0-flash-free`
- `nemotron-3-ultra-free`
- `north-mini-code-free`
- `laguna-s-2.1-free`

All seven currently use Chat Completions. Synchronization may add or remove
models, but the strict allow rule prevents a newly added paid Zen model from
appearing.

The provider reuses the protected OpenCode primary and backup credential files.
The key is not duplicated, copied into app preferences, or passed in process
arguments.

## Selection flow

1. The tray loads the full router snapshot, including hidden routes.
2. The user selects a model.
3. If its provider is disabled, the control layer enables only that provider
   and rebuilds the local catalog.
4. The control layer validates that the model is installed, authenticated, and
   routable.
5. It writes the canonical model slug as the user-level default for the next
   Codex task while preserving the existing ChatGPT login and provider mode.
6. The tray shows `Later` and `Restart`.
7. `Restart` uses the existing graceful Codex restart path. `Later` only shows
   a reminder that a restart is required before the new default appears.

Selection failures leave the previous default and provider selection intact.

## Control-plane changes

The control snapshot will expose, for each model:

- canonical slug;
- display name;
- provider;
- enabled state;
- picker visibility;
- optional family and role metadata.

`control model-set` will support both authenticated router mode and existing
login-free mode. In authenticated mode it writes the external canonical slug
without changing `model_provider = "openai"` or any ChatGPT credential. In
login-free mode it retains the current native-alias behavior.

The Swift app calls the control process. It does not edit TOML or JSON files
directly.

## Safety and cost controls

- Paid Zen models are excluded by ID before registry merge and before UI
  rendering.
- No paid live test is part of this feature.
- API keys remain in mode-600 protected files and never enter SwiftUI state.
- The primary/backup failover rule remains authentication-only: HTTP 401 or
  403, never quota or rate-limit responses.
- A selection never changes the model of a running task.
- A failed enable, catalog rebuild, config write, or restart restores the
  previous selection where possible and shows a concise error.

## Updates

Go and Free catalogs synchronize during normal router install/update and from
the tray's existing Update & Verify action. SOTA visibility is recalculated on
each sync. Favorites are matched by canonical slug; an unavailable favorite is
shown as unavailable until it returns or the user removes it.

## Verification

Use local fixtures only:

- SOTA replacement keeps old routes hidden and new routes visible.
- Free discovery accepts only `big-pickle` and `-free` IDs.
- Model selection preserves ChatGPT authentication and provider mode.
- `Later` does not restart Codex.
- `Restart` uses the graceful restart path.
- Provider-enable or config-write failure preserves the previous selection.
- Swift build succeeds on macOS.

No provider request is required for these checks.

## Acceptance criteria

- The normal Codex picker remains SOTA-focused.
- Every Go model is searchable in the menu-bar app.
- Every documented free OpenCode model is searchable in the Free tab.
- No paid Zen model is shown or routed by the Free provider.
- Selecting a model offers `Later` and `Restart`.
- Running tasks, ChatGPT login, MCP servers, skills, and existing Codex settings
  remain unchanged.
- Normal router updates refresh model catalogs without removing the local
  provider extension.
