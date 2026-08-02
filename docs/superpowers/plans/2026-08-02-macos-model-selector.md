# macOS Model Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native menu-bar selector for SOTA, all OpenCode Go, and strictly free OpenCode models without exposing paid Zen models or changing running Codex tasks.

**Architecture:** Extend the existing Node control plane and SwiftUI Model Router tray. The Node registry owns provider discovery, filtering, authentication, catalog generation, and atomic Codex configuration changes. SwiftUI consumes the control snapshot, presents search and favorites, and asks whether to restart Codex after saving the next-task model.

**Tech Stack:** Node.js ES modules, JSON provider registry, `node:test`, Swift 5.10, SwiftUI, AppKit, Swift Package Manager.

## Global Constraints

- Preserve native GPT models, ChatGPT authentication, MCP servers, skills, and all unrelated Codex settings.
- Do not add or route paid OpenCode Zen models.
- The Free provider may discover only `big-pickle` and IDs ending in `-free`.
- Reuse the existing protected OpenCode primary and backup credential files; never copy keys into Swift state or process arguments.
- Selecting a model changes only the default for a new task; it never changes a running task.
- Codex restart must be graceful and optional after every selection.
- Do not run a paid live provider test.
- Keep the implementation compatible with macOS 13 and Swift 5.10.

## File structure

- `config/providers.json`: declares `opencode-free`, shared credentials, catalog filter, and hidden picker policy.
- `src/model-registry.mjs`: validates provider discovery filters and model picker metadata.
- `src/sync-auto-models.mjs`: filters discovery before merge and keeps Free entries hidden.
- `src/config-manager.mjs`: atomically updates the root `model` value without changing provider mode.
- `src/control.mjs`: exposes full model metadata and safely selects native or external models.
- `apps/macos/ModelRouterTray/Sources/ModelSelectorModels.swift`: search, family grouping, tabs, roles, and favorites data model.
- `apps/macos/ModelRouterTray/Sources/ModelSelectorView.swift`: native selector UI and restart confirmation.
- `apps/macos/ModelRouterTray/Sources/ModelRouterTrayApp.swift`: store operations, control integration, and selector placement.
- `apps/macos/ModelRouterTray/Tests/ModelRouterTrayTests/ModelSelectorModelsTests.swift`: deterministic selector-model tests.
- `test/sync-auto-models.test.mjs`: strict Free discovery regression.
- `test/control.test.mjs`: authenticated and login-free model-selection behavior.
- `docs/MACOS-TRAY.md` and `README.md`: user behavior and safety notes.

---

### Task 1: Strict OpenCode Free provider

**Files:**
- Modify: `config/providers.json`
- Modify: `src/model-registry.mjs`
- Modify: `src/sync-auto-models.mjs`
- Modify: `test/sync-auto-models.test.mjs`

**Interfaces:**
- Consumes: existing `discoverProviderModels(providerId)` and protected credential metadata.
- Produces: `filteredDiscoveredModelIds(provider, discovered) -> string[]` and registry provider `opencode-free`.

- [ ] **Step 1: Write the failing Free discovery test**

Add a second integration test using the existing fixture path:

```js
test("OpenCode Free sync excludes every paid Zen model", () => {
  const testRoot = mkdtempSync(path.join(os.tmpdir(), "opencode-free-sync-"));
  const stateDir = path.join(testRoot, "state");
  const fixturePath = path.join(testRoot, "free-models.json");
  try {
    writeFileSync(fixturePath, JSON.stringify({
      data: [
        { id: "big-pickle" },
        { id: "deepseek-v4-flash-free" },
        { id: "mimo-v2.5-free" },
        { id: "gpt-5.6-sol" },
        { id: "claude-opus-5" },
      ],
    }));
    execFileSync(
      process.execPath,
      ["src/sync-auto-models.mjs", "opencode-free", "--fixture", fixturePath],
      { cwd: root, env: { ...process.env, MODEL_ROUTER_STATE_DIR: stateDir } },
    );
    const models = JSON.parse(
      readFileSync(path.join(stateDir, "user-models.json"), "utf8"),
    ).models;
    assert.deepEqual(models.map((model) => model.upstreamModel).sort(), [
      "big-pickle",
      "deepseek-v4-flash-free",
      "mimo-v2.5-free",
    ]);
    assert.ok(models.every((model) => model.pickerVisibility === "hide"));
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the targeted test and confirm the intended failure**

Run:

```sh
env -u OLLAMA_API_KEY -u OLLAMA_CLOUD_API_KEY node --test test/sync-auto-models.test.mjs
```

Expected: FAIL because `opencode-free` is unknown.

- [ ] **Step 3: Add the Free provider registry entry**

Add:

```json
{
  "id": "opencode-free",
  "displayName": "OpenCode Free",
  "kind": "openai-compatible",
  "ownedBy": "opencode",
  "baseUrl": "https://opencode.ai/zen/v1",
  "baseUrlEnv": "OPENCODE_FREE_BASE_URL",
  "autoSyncModels": true,
  "modelAllowPatterns": ["^big-pickle$", "-free$"],
  "pickerPolicy": "hide-all",
  "credential": {
    "environment": ["OPENCODE_GO_API_KEY"],
    "file": "opencode-go-api-key.secret",
    "fallbackFiles": ["opencode-go-api-key-backup.secret"],
    "legacyFiles": [],
    "keychainServices": ["codex-router-opencode-go"],
    "prompt": "OpenCode API key"
  }
}
```

Validate `modelAllowPatterns` as non-empty strings that compile as regular
expressions and validate `pickerPolicy` as `hide-all` when present.

- [ ] **Step 4: Filter discovery before merge**

Implement:

```js
export function filteredDiscoveredModelIds(provider, discovered) {
  const patterns = (provider.modelAllowPatterns || []).map((value) => new RegExp(value));
  const unique = [...new Set(discovered)];
  return patterns.length
    ? unique.filter((id) => patterns.some((pattern) => pattern.test(id)))
    : unique;
}
```

Use the filtered IDs for registration, merge, result counts, and stale-entry
removal. Return an empty `pickerModelIds` set when `pickerPolicy === "hide-all"`.

- [ ] **Step 5: Run the targeted test**

Run the same `node --test test/sync-auto-models.test.mjs` command.

Expected: PASS with only the three fixture Free models written and hidden.

- [ ] **Step 6: Commit**

```sh
git add config/providers.json src/model-registry.mjs src/sync-auto-models.mjs test/sync-auto-models.test.mjs
git commit -m "feat: add strictly filtered OpenCode Free models"
```

---

### Task 2: Safe next-task model selection

**Files:**
- Modify: `src/config-manager.mjs`
- Modify: `src/control.mjs`
- Modify: `test/control.test.mjs`

**Interfaces:**
- Consumes: `MODEL_BY_SLUG`, native model catalog, provider credential status, provider selection, catalog generator, and native aliases.
- Produces: `control model-set <slug>` for native, authenticated external, and login-free external models.

- [ ] **Step 1: Extend the failing control test**

Create an authenticated router configuration first with the existing
`config-manager enable` command, then assert:

```js
const selected = runControl("model-set", "deepseek/deepseek-v4-pro");
assert.equal(selected.model, "deepseek/deepseek-v4-pro");
assert.equal(selected.model_provider, "openai");
assert.equal(selected.login_free, false);
```

Also assert native selection:

```js
const native = runControl("model-set", "gpt-5.6-sol");
assert.equal(native.model, "gpt-5.6-sol");
assert.equal(native.model_provider, "openai");
```

Keep the existing login-free alias assertions. Add a failure case showing that
an unconfigured external provider leaves both the model and enabled provider
list unchanged.

- [ ] **Step 2: Run the focused control test**

Run:

```sh
env -u OLLAMA_API_KEY -u OLLAMA_CLOUD_API_KEY node --test test/control.test.mjs
```

Expected: FAIL with the current “requires login-free mode” error.

- [ ] **Step 3: Add atomic `model-set` to the config manager**

Accept `config-manager.mjs model-set <slug>`. Reject an empty slug. Reuse
`replaceRootValue` and `atomicWrite`:

```js
} else if (command === "model-set") {
  const model = String(process.argv[3] || "").trim();
  if (!model) throw new Error("A model slug is required.");
  next = `${replaceRootValue(current, "model", model)}\n`;
}
```

Do not modify `model_provider`, managed router blocks, authentication files, or
provider-mode backup state.

- [ ] **Step 4: Generalize control model selection**

Replace `setLoginFreeModel` with `setCodexModel(slug)`:

```js
async function setCodexModel(slug) {
  // Resolve native or canonical external route.
  // Validate external credentials before changing provider selection.
  // In router mode, enable the external provider and rebuild the catalog.
  // In login-free mode, preserve native alias mapping.
  // Invoke config-manager model-set and print its JSON snapshot.
}
```

For an external provider that is configured but disabled:

1. save the previous provider list;
2. enable the provider;
3. rebuild `catalog.mjs`;
4. write the model;
5. restore the previous provider list if steps 3 or 4 fail.

Native model selection must never change provider selection.

- [ ] **Step 5: Run the focused control test**

Expected: PASS for native, authenticated external, login-free alias, and
rollback cases.

- [ ] **Step 6: Commit**

```sh
git add src/config-manager.mjs src/control.mjs test/control.test.mjs
git commit -m "feat: select the next Codex model safely"
```

---

### Task 3: Selector data model and Swift store integration

**Files:**
- Modify: `apps/macos/ModelRouterTray/Package.swift`
- Create: `apps/macos/ModelRouterTray/Sources/ModelSelectorModels.swift`
- Create: `apps/macos/ModelRouterTray/Tests/ModelRouterTrayTests/ModelSelectorModelsTests.swift`
- Modify: `apps/macos/ModelRouterTray/Sources/ModelRouterTrayApp.swift`
- Modify: `src/control.mjs`

**Interfaces:**
- Consumes: control snapshot `RouterModel` entries and `control model-set`.
- Produces: `ModelCatalogTab`, `ModelSelectorEntry`, `ModelSelectorCatalog`, and `RouterStore.selectModel(_:restart:)`.

- [ ] **Step 1: Add a Swift test target and failing selector tests**

Add `.testTarget(name: "ModelRouterTrayTests", dependencies: ["ModelRouterTray"])`.
Test exact behavior:

```swift
@testable import ModelRouterTray

func testSearchAndFamilyGrouping() {
  let models = [
    ModelSelectorEntry(slug: "opencode-go/kimi-k3", name: "Kimi K3", provider: "opencode-go", pickerVisibility: "list"),
    ModelSelectorEntry(slug: "opencode-go/kimi-k2.7-code", name: "Kimi K2.7 Code", provider: "opencode-go", pickerVisibility: "hide"),
    ModelSelectorEntry(slug: "opencode-free/big-pickle", name: "Big Pickle", provider: "opencode-free", pickerVisibility: "hide"),
  ]
  let catalog = ModelSelectorCatalog(models: models, favorites: [])
  XCTAssertEqual(catalog.models(for: .sota, search: "").map(\.slug), ["opencode-go/kimi-k3"])
  XCTAssertEqual(catalog.models(for: .go, search: "k2.7").map(\.slug), ["opencode-go/kimi-k2.7-code"])
  XCTAssertEqual(catalog.models(for: .free, search: "").map(\.slug), ["opencode-free/big-pickle"])
  XCTAssertEqual(catalog.family(for: models[0]), "Kimi")
}
```

- [ ] **Step 2: Run Swift tests and confirm the intended compile failure**

Run:

```sh
swift test --package-path apps/macos/ModelRouterTray
```

Expected: FAIL because selector types do not exist.

- [ ] **Step 3: Implement selector types**

Define:

```swift
enum ModelCatalogTab: String, CaseIterable, Identifiable {
  case sota = "SOTA"
  case go = "OpenCode Go"
  case free = "Free"
  var id: String { rawValue }
}

struct ModelSelectorEntry: Identifiable, Equatable {
  let slug: String
  let name: String
  let provider: String
  let pickerVisibility: String
  var id: String { slug }
}
```

`ModelSelectorCatalog.models(for:search:)` must filter by tab, then perform a
case-insensitive search over name, slug, provider, and family. Family matching
uses explicit prefixes for Kimi, MiniMax, DeepSeek, Qwen, GLM, Grok, MiMo, Hy,
GPT, and Free fallback.

- [ ] **Step 4: Expose model metadata from the Node snapshot**

Add `pickerVisibility`, `native`, and a stable family label to `emitProbe()`.
All registry models stay in the snapshot even when hidden from the Codex
picker.

- [ ] **Step 5: Extend Swift decoding and store actions**

Extend `RouterModel` with optional fields so older router snapshots still
decode:

```swift
let pickerVisibility: String?
let native: Bool?
let family: String?
```

Add published selection state and:

```swift
func selectModel(_ slug: String, restart: Bool) async {
  // runControl(["model-set", slug])
  // refresh snapshot
  // optionally call restartCodexApp()
  // publish success or concise error
}
```

- [ ] **Step 6: Run focused Node and Swift tests**

Run:

```sh
env -u OLLAMA_API_KEY -u OLLAMA_CLOUD_API_KEY node --test test/control.test.mjs
swift test --package-path apps/macos/ModelRouterTray
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```sh
git add src/control.mjs apps/macos/ModelRouterTray/Package.swift apps/macos/ModelRouterTray/Sources/ModelSelectorModels.swift apps/macos/ModelRouterTray/Sources/ModelRouterTrayApp.swift apps/macos/ModelRouterTray/Tests/ModelRouterTrayTests/ModelSelectorModelsTests.swift
git commit -m "feat: add model selector data flow"
```

---

### Task 4: Native model selector interface

**Files:**
- Create: `apps/macos/ModelRouterTray/Sources/ModelSelectorView.swift`
- Modify: `apps/macos/ModelRouterTray/Sources/ModelRouterTrayApp.swift`
- Modify: `apps/macos/ModelRouterTray/Tests/ModelRouterTrayTests/ModelSelectorModelsTests.swift`

**Interfaces:**
- Consumes: `ModelSelectorCatalog`, `RouterStore.snapshot`, `RouterStore.selectModel(_:restart:)`.
- Produces: `ModelSelectorView` embedded in `TrayView`.

- [ ] **Step 1: Add failing favorite and selection-state tests**

Assert that favorites appear first without duplicating entries and that a
selected hidden Go or Free model remains visible in its provider tab.

```swift
func testFavoritesAreStableAndDeduplicated() {
  let catalog = ModelSelectorCatalog(models: models, favorites: [models[1].slug, models[1].slug])
  XCTAssertEqual(catalog.favoriteModels.map(\.slug), [models[1].slug])
}
```

- [ ] **Step 2: Run Swift tests and confirm failure**

Run `swift test --package-path apps/macos/ModelRouterTray`.

Expected: FAIL until favorite ordering is implemented.

- [ ] **Step 3: Implement `ModelSelectorView`**

Build a native SwiftUI view with:

- current-model header and green service status;
- `TextField("Search models", text: $search)`;
- segmented `Picker` for SOTA, OpenCode Go, and Free;
- grouped `LazyVStack` rows with provider badge, role badge, star, and checkmark;
- confirmation dialog with `Later`, `Restart`, and `Cancel`;
- progress disabling while a selection operation runs;
- concise inline errors and no key or raw command output.

Use system materials, system typography, an 8-point spacing rhythm, and the
existing router accent colors. Do not add third-party UI dependencies.

- [ ] **Step 4: Integrate with the tray**

Place `ModelSelectorView(store: store)` before usage sections. Increase the
popover frame only as needed, targeting approximately 392 by 680 points. Keep
all current usage, provider, maintenance, and Island controls reachable in the
same scroll view.

Persist favorite slugs under `ModelRouterTray.favoriteModels` in
`UserDefaults`.

- [ ] **Step 5: Run Swift tests and release build**

```sh
swift test --package-path apps/macos/ModelRouterTray
swift build -c release --package-path apps/macos/ModelRouterTray
```

Expected: PASS and release build exit 0.

- [ ] **Step 6: Commit**

```sh
git add apps/macos/ModelRouterTray/Sources/ModelSelectorView.swift apps/macos/ModelRouterTray/Sources/ModelRouterTrayApp.swift apps/macos/ModelRouterTray/Tests/ModelRouterTrayTests/ModelSelectorModelsTests.swift
git commit -m "feat: add native menu-bar model selector"
```

---

### Task 5: Documentation, installation, and local verification

**Files:**
- Modify: `README.md`
- Modify: `docs/MACOS-TRAY.md`

**Interfaces:**
- Consumes: completed provider, control, and SwiftUI tasks.
- Produces: installed `Model Router.app` and documented safe workflow.

- [ ] **Step 1: Document the selector**

Document:

- SOTA, Go, and Free tabs;
- Free provider strict allow rule;
- `Later` versus graceful `Restart`;
- hidden models remain routable;
- paid Zen models are excluded;
- catalog refresh occurs during Update & Verify.

- [ ] **Step 2: Run only relevant local checks**

```sh
git diff --check
npm run check
env -u OLLAMA_API_KEY -u OLLAMA_CLOUD_API_KEY node --test test/sync-auto-models.test.mjs test/control.test.mjs test/catalog.test.mjs
swift test --package-path apps/macos/ModelRouterTray
swift build -c release --package-path apps/macos/ModelRouterTray
```

Expected: zero failures. These checks use no provider request.

- [ ] **Step 3: Commit documentation**

```sh
git add README.md docs/MACOS-TRAY.md
git commit -m "docs: explain the macOS model selector"
```

- [ ] **Step 4: Deploy the stable source and regenerate local catalogs**

Transfer the reviewed commits to `/Users/panacekoliver/.local/share/codex-router`,
then run:

```sh
./install.sh --target codex --auto --providers opencode-go
```

This leaves Free disabled until the user selects a Free model in the tray.
Do not enable a paid Zen provider. Verify the merged catalog has only SOTA
models with `visibility = list`; Go fallbacks and all Free models must remain
present with `visibility = hide`.

- [ ] **Step 5: Build and install the menu-bar app**

```sh
./scripts/build-macos-tray-app.sh "/Users/panacekoliver/Applications/Model Router.app"
```

Open the installed app, confirm the three tabs, search, favorite behavior, and
restart prompt. Do not select a model in a running task during visual review.

- [ ] **Step 6: Final safety verification**

Confirm:

- ChatGPT login is still available;
- `model_provider` remains `openai` in authenticated mode;
- config and both OpenCode key files remain mode 600;
- MCP server count and skill directory count match the pre-change values;
- router health is OK;
- no paid live request was sent.
