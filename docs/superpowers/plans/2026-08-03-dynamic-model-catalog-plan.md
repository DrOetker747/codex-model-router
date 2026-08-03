# Dynamic Model Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize enabled provider catalogs, build a deterministic merged SOTA catalog, and expose safe model selection to Codex Desktop, Model Picker, and compatible subagents.

**Architecture:** The Node control plane owns discovery, validation, LKG state, merged-catalog rebuilding, SOTA ranking, and agent-profile generation. The Desktop UI and existing native macOS apps consume one snapshot and request model changes through `control`; they never edit provider or Codex configuration directly.

**Tech Stack:** Node.js ES modules, JSON provider configuration, `node:test`, existing Codex Router control commands, SwiftUI/AppKit, Swift Package Manager, local fixtures, and free or low-cost smoke checks.

## Global Constraints

- Model Picker remains installed and remains the compact SOTA view.
- After a graceful restart, the native Codex Desktop switcher shows native OpenAI models and current external models from the merged catalog.
- Sync all enabled providers on every catalog refresh; a disabled provider is not fetched or merged.
- Preserve the exact canonical model ID `qwen3.8-max` when a live provider catalog returns it.
- SOTA ranking uses live valid catalog metadata and a stable tie-breaker. A missing model is not fabricated from a hardcoded list.
- Each provider LKG record stores `models`, `fetchedAt`, `ageMs`, and `state` with one of `fresh`, `stale`, `unavailable`, or `invalid`.
- A failed fetch never replaces a valid configuration. Stale data is labelled stale and is not reported as fresh.
- Rebuild the merged catalog and only the compatible selected subagent profiles after a successful or explicitly usable LKG refresh.
- Keep Sol and Luna as root profiles and add external models only as compatible subagent routes.
- Keep ChatGPT login, MCP servers, skills, credentials, provider settings, and unrelated Codex configuration unchanged.
- Use local fixtures plus free or low-cost live checks. Paid live tests require explicit approval.
- Keep this change in the current repository. A separate repository is outside this release.
- Deliver the implementation in one final commit with message `docs: plan dynamic model catalog` for this planning change.

## File map

- `src/model-discovery.mjs`: fetch, validate, normalize, and classify provider catalog responses.
- `src/sync-auto-models.mjs`: synchronize every enabled provider and update provider LKG records.
- `src/user-models.mjs`: persist canonical merged model entries and LKG metadata.
- `src/catalog.mjs`: rebuild the merged catalog and expose stable catalog snapshots.
- `src/model-registry.mjs`: validate provider capabilities, aliases, and catalog metadata.
- `src/curate-models.mjs`: rank the deterministic live SOTA set.
- `src/codex-agent-catalog.mjs`: rebuild selected compatible Sol, Luna, and external subagent profiles.
- `src/control.mjs` and `src/config-manager.mjs`: expose safe model selection and rollback-safe writes.
- `src/router.mjs` and `src/providers.mjs`: preserve provider enablement, credentials, and restart boundaries.
- `apps/desktop/ui/model.mjs`: render the merged catalog in the native Desktop switcher after restart.
- `apps/macos/ModelPicker/main.m`: retain the existing compact Model Picker and its SOTA input.
- `apps/macos/ModelRouterTray/Sources/ModelRouterTrayApp.swift`: connect the tray to the control snapshot and restart action.
- `apps/macos/ModelRouterTray/Sources/ModelSelectorModels.swift`: decode and filter merged model entries.
- `test/model-discovery.test.mjs`, `test/sync-auto-models.test.mjs`, `test/user-models.test.mjs`, `test/catalog.test.mjs`: sync and LKG tests.
- `test/codex-agent-catalog.test.mjs`, `test/control.test.mjs`, `test/desktop-ui.test.mjs`, `test/macos-model-picker.test.mjs`: profile, control, and UI tests.

---

### Task 1: Provider sync and LKG state

**Files:**
- Modify: `src/model-discovery.mjs`, `src/sync-auto-models.mjs`, `src/user-models.mjs`, `src/catalog.mjs`
- Test: `test/model-discovery.test.mjs`, `test/sync-auto-models.test.mjs`, `test/user-models.test.mjs`, `test/catalog.test.mjs`

**Interfaces:**
- `syncEnabledProviderCatalogs({ enabledProviders, fetchCatalog, now }) -> { providers, models, lkg }`
- `readProviderLkg(providerId) -> { models, fetchedAt, ageMs, state } | null`
- `writeProviderLkg(providerId, record) -> void`
- `buildMergedCatalog(providerRecords) -> { models, providers, generatedAt }`

- [ ] Write fixture tests for two enabled providers, one disabled provider, a valid response containing `qwen3.8-max`, an invalid response, and a fetch failure.
- [ ] Run `node --test test/model-discovery.test.mjs test/sync-auto-models.test.mjs test/user-models.test.mjs test/catalog.test.mjs` and confirm the new assertions fail.
- [ ] Implement normalization, enabled-provider iteration, LKG persistence, `ageMs`, and the four explicit states. Use the previous valid LKG only as labelled stale data.
- [ ] Rebuild the merged catalog only from valid fresh data or an explicitly usable stale LKG record. Keep disabled-provider entries out of the result.
- [ ] Run the same command and require PASS, including exact preservation of `qwen3.8-max`.

### Task 2: Deterministic live-catalog SOTA ranking

**Files:**
- Modify: `src/curate-models.mjs`, `src/catalog.mjs`, `src/model-registry.mjs`
- Test: `test/catalog.test.mjs`, `test/model-discovery.test.mjs`

**Interfaces:**
- `rankSotaModels(liveCatalog, policy) -> Array<{ slug, rank, reason }>`
- `applySotaVisibility(mergedCatalog, sotaEntries) -> mergedCatalog`
- `compareModelRecords(a, b) -> number`

- [ ] Add fixtures with native OpenAI entries, several external families, `qwen3.8-max`, an older route, duplicate IDs, and equal-priority entries. Assert that a live model is selected only once and old routes remain routable but hidden.
- [ ] Run `node --test test/catalog.test.mjs test/model-discovery.test.mjs` and confirm the ranking assertions fail.
- [ ] Implement one stable comparator using explicit catalog priority, capability metadata, recency, provider ID, and canonical slug as deterministic tie-breakers. Do not rank from an offline model list.
- [ ] Recalculate visibility from the live merged catalog on every rebuild. Keep `qwen3.8-max` eligible whenever it is present and compatible.
- [ ] Run the same command twice against the same fixture and require identical order and PASS.

### Task 3: Control, selection, and graceful restart

**Files:**
- Modify: `src/control.mjs`, `src/config-manager.mjs`, `src/router.mjs`, `src/providers.mjs`
- Test: `test/control.test.mjs`, `test/router-health.test.mjs`

**Interfaces:**
- `control model-catalog --json -> CatalogSnapshot`
- `control model-set <canonicalSlug> -> SelectionResult`
- `control codex-restart -> RestartResult`
- `setNextTaskModel(slug, { restart }) -> SelectionResult`

- [ ] Add tests for native OpenAI selection, external selection, disabled-provider enablement, failed catalog rebuild, graceful restart, and restart failure. Snapshot login, MCP, skills, provider mode, and the previous model before each test.
- [ ] Run `node --test test/control.test.mjs test/router-health.test.mjs` and confirm the new cases fail.
- [ ] Implement JSON catalog output, canonical-slug validation, atomic next-task model writes, provider rollback on failure, and graceful restart through the existing router path. Never pass credentials in arguments.
- [ ] Ensure `restart: false` changes only the next-task default and `restart: true` restarts Codex only after the write succeeds. Preserve `model_provider = "openai"` where the current authenticated mode requires it.
- [ ] Run the same command and require PASS with unchanged protected-state snapshots.

### Task 4: Compatible agent profiles

**Files:**
- Modify: `src/codex-agent-catalog.mjs`, `src/catalog.mjs`, `src/model-registry.mjs`
- Test: `test/codex-agent-catalog.test.mjs`, `test/catalog.test.mjs`

**Interfaces:**
- `rebuildCompatibleAgentProfiles({ mergedCatalog, selectedProfiles }) -> AgentProfileCatalog`
- `isCompatibleSubagent(model, profile) -> boolean`
- `rootProfiles() -> [{ id: "sol" }, { id: "luna" }]`

- [ ] Add a fixture proving Sol and Luna remain root profiles, a compatible external model becomes a subagent route, and an incompatible model is excluded without deleting an existing route.
- [ ] Run `node --test test/codex-agent-catalog.test.mjs test/catalog.test.mjs` and confirm the new cases fail.
- [ ] Implement capability-based profile selection from merged live metadata. Rebuild only selected compatible profiles and retain stable root IDs, display names, and role settings.
- [ ] Tie profile rebuild output to the same catalog generation used by the Desktop switcher and control snapshot.
- [ ] Run the same command and require PASS with stable profile ordering and no root-profile replacement.

### Task 5: macOS UI and Desktop integration

**Files:**
- Modify: `apps/desktop/ui/model.mjs`, `apps/macos/ModelPicker/main.m`, `apps/macos/ModelRouterTray/Sources/ModelRouterTrayApp.swift`, `apps/macos/ModelRouterTray/Sources/ModelSelectorModels.swift`
- Test: `test/desktop-ui.test.mjs`, `test/macos-model-picker.test.mjs`, `apps/macos/ModelRouterTray/Tests/ModelRouterTrayTests/ModelSelectorModelsTests.swift`

**Interfaces:**
- `loadCatalogSnapshot() -> CatalogSnapshot`
- `selectModel(slug, restart) -> SelectionResult`
- `ModelSelectorCatalog.models(for:search:) -> [ModelSelectorEntry]`

- [ ] Add fixture tests that show native OpenAI and current external entries in the Desktop switcher after a restart, while the Model Picker keeps only the SOTA view.
- [ ] Run `node --test test/desktop-ui.test.mjs test/macos-model-picker.test.mjs` and `swift test --package-path apps/macos/ModelRouterTray`; confirm the new cases fail.
- [ ] Implement snapshot loading, search, canonical-slug selection, `Later` and graceful `Restart`, stale-state labels, and concise errors. Keep credentials out of Swift state.
- [ ] Keep the existing Model Picker entry point and update only its catalog input. Do not create a second picker or edit TOML/JSON directly from the apps.
- [ ] Run the Node tests, `swift test --package-path apps/macos/ModelRouterTray`, and `swift build -c release --package-path apps/macos/ModelRouterTray`; require PASS and exit 0.

### Task 6: Release, documentation, and full tests

**Files:**
- Modify: `README.md`, `docs/MACOS-TRAY.md`
- Test: all targeted tests from Tasks 1 through 5 and `test/setup.test.mjs`

**Interfaces:**
- Document the user-visible catalog states, sync behavior, SOTA rules, restart flow, Sol/Luna roots, and safety boundary.
- Release the merged catalog and selected profiles as one verified generation.

- [ ] Document enabled-provider sync, LKG age and state, deterministic SOTA, `qwen3.8-max`, Desktop restart behavior, Model Picker continuity, and external subagent routes.
- [ ] Run `git diff --check` and the targeted Node and Swift commands from Tasks 1 through 5. Use fixtures for paid providers and only free or low-cost live checks.
- [ ] Verify that ChatGPT login, MCP servers, skills, provider credentials, and unrelated settings match the pre-change snapshots. Verify that a failed sync leaves the previous merged catalog available.
- [ ] Build the release artifacts and inspect the final catalog, Desktop switcher, Model Picker, and Sol/Luna profile IDs. A separate repository is not part of this release.
- [ ] For this planning change, stage only the two requested documents and create the required commit:

```sh
git add -- docs/superpowers/specs/2026-08-03-dynamic-model-catalog-design.md \
  docs/superpowers/plans/2026-08-03-dynamic-model-catalog-plan.md
git commit -m "docs: plan dynamic model catalog"
```
