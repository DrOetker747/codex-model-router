# Dynamic Model Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize enabled provider catalogs, generate the native Codex catalog, rank SOTA from real metadata, and expose safe external subagent routes without changing native Codex ownership.

**Architecture:** The Node control plane owns discovery, validation, backoff, LKG state, merged-catalog rebuilding, SOTA ranking, and external profile generation. It atomically writes `model_catalog_json` to the user Codex `config.toml`. The existing Model Picker and macOS tray consume the same snapshot; Codex Desktop is integrated only through that generated config and a full user-selected restart.

**Tech Stack:** Node.js ES modules, JSON provider configuration, `node:test`, `launchd`, atomic file replacement, SwiftUI/AppKit, Swift Package Manager, local fixtures, and free or low-cost smoke checks.

## Global Constraints

- Preserve the existing Model Picker, including all current sections and lists. SOTA is one section.
- Integrate the native Codex Desktop switcher only through generated `model_catalog_json` in the user `config.toml` and a full restart.
- Synchronize every enabled provider on a regular `launchd` schedule. Apply bounded exponential backoff, a single-flight lock, and atomic LKG writes.
- Preserve the exact canonical model ID `qwen3.8-max` when returned by a live provider.
- Rank SOTA from real available metadata. Use provider `created` timestamps only when present; otherwise use deterministic version and family parsing under a tested policy.
- Each provider LKG record stores `models`, `fetchedAt`, `ageMs`, and one state: `fresh`, `stale`, `unavailable`, or `invalid`.
- A failed sync never deletes the last usable catalog or changes the selected model.
- Preserve native OpenAI/Codex Sol and Luna models. Generate only selected compatible external subagent profiles.
- Never restart Codex without an explicit user choice. The app shows when a newer catalog exists and that restart is required.
- Preserve ChatGPT login, MCP servers, skills, credentials, provider settings, and unrelated Codex configuration.
- Use local fixtures plus free or low-cost live checks. Paid live tests require explicit approval.
- Finalization includes a new user-owned GitHub repository, upstream attribution, MIT license, secret scan, CI, release artifacts, and push only after verification.

## Verified file map

Existing repository files used by the implementation:

- `src/model-discovery.mjs`: fetch, validate, normalize, and classify provider responses.
- `src/sync-auto-models.mjs`: synchronize enabled providers.
- `src/user-models.mjs`: persist canonical model entries.
- `src/catalog.mjs`: build the merged catalog and snapshot.
- `src/model-registry.mjs`: validate provider and model metadata.
- `src/curate-models.mjs`: apply the SOTA policy.
- `src/config-manager.mjs`: atomically write `model_catalog_json` and the next-task model to `config.toml`.
- `src/control.mjs`, `src/router.mjs`, `src/providers.mjs`: expose control operations and preserve provider state.
- `src/service-macos.mjs`, `src/service-operation-lock.mjs`, `src/update.mjs`: scheduling, locking, and update flow.
- `src/codex-agent-catalog.mjs`: preserve native profiles and build selected external profiles.
- `src/target-integration.mjs`, `src/install-manifest.mjs`, `src/tray-install.mjs`: align checkouts and install one verified commit.
- `apps/macos/ModelPicker/main.m`, `apps/macos/ModelRouterTray/Sources/ModelRouterTrayApp.swift`, and `apps/macos/ModelRouterTray/Sources/ModelSelectorModels.swift`: consume the fresh snapshot.
- `scripts/build-macos-model-picker.sh`, `scripts/build-macos-tray-app.sh`, and `scripts/build-desktop-tray.sh`: build release artifacts.
- `docs/INSTALL.md`, `docs/DESKTOP-TRAY.md`, `docs/MACOS-TRAY.md`, and `README.md`: document operation and release safety.
- `test/model-discovery.test.mjs`, `test/sync-auto-models.test.mjs`, `test/user-models.test.mjs`, `test/catalog.test.mjs`, `test/config-manager.test.mjs`, `test/control.test.mjs`, `test/codex-agent-catalog.test.mjs`, `test/macos-model-picker.test.mjs`, `test/service-operation-lock.test.mjs`, `test/update-target.test.mjs`, and `test/tray-install.test.mjs`: targeted regression coverage.

New files are marked `Create` below. Each has one responsibility and is not assumed to exist.

---

### Task 1: Enabled-provider sync, launchd schedule, and LKG

**Files:**
- Modify: `src/model-discovery.mjs`, `src/sync-auto-models.mjs`, `src/user-models.mjs`, `src/service-macos.mjs`, `src/service-operation-lock.mjs`, `src/update.mjs`
- Create: `src/catalog-lkg.mjs` for atomic LKG I/O, age calculation, and state transitions.
- Create: `config/launchd/com.codexrouter.catalog-sync.plist` for the regular macOS sync job.
- Test: `test/model-discovery.test.mjs`, `test/sync-auto-models.test.mjs`, `test/user-models.test.mjs`, `test/service-operation-lock.test.mjs`
- Create: `test/catalog-lkg.test.mjs` for atomic replacement and state transitions.

**Interfaces:**
- `syncEnabledProviderCatalogs({ enabledProviders, fetchCatalog, now }) -> { providers, models, lkg }`
- `readProviderLkg(providerId) -> { models, fetchedAt, ageMs, state } | null`
- `writeProviderLkg(providerId, record) -> void`
- `withCatalogSingleFlight(lockPath, operation) -> Promise<Result>`

- [ ] Add fixtures for two enabled providers, one disabled provider, `qwen3.8-max`, invalid JSON, timeout, and non-2xx response. Assert that disabled providers are not fetched.
- [ ] Run `node --test test/model-discovery.test.mjs test/sync-auto-models.test.mjs test/user-models.test.mjs test/service-operation-lock.test.mjs test/catalog-lkg.test.mjs`; confirm the new assertions fail.
- [ ] Implement canonical normalization, enabled-provider iteration, bounded exponential backoff, single-flight locking, and the four LKG states. Replace records with a temporary file plus `rename`, never with a partial write.
- [ ] Install the plist through the existing macOS service path. Include a successful interval, retry backoff, and no overlapping sync process.
- [ ] Run the same command and require PASS, including exact preservation of `qwen3.8-max` and the previous LKG after failure.
- [ ] Commit independently: `git add src config/launchd test && git commit -m "feat: add provider LKG sync"`.

### Task 2: Deterministic SOTA ranking from available metadata

**Files:**
- Modify: `src/curate-models.mjs`, `src/catalog.mjs`, `src/model-registry.mjs`
- Test: `test/catalog.test.mjs`, `test/model-discovery.test.mjs`

**Interfaces:**
- `parseModelFamilyAndVersion(modelId) -> { family, versionParts }`
- `rankSotaModels(catalog, policy) -> Array<{ slug, rank, reason }>`
- `applySotaVisibility(mergedCatalog, sotaEntries) -> mergedCatalog`
- `compareModelRecords(a, b) -> number`

- [ ] Add fixtures with native OpenAI entries, external families, `qwen3.8-max`, a real provider `created` timestamp, a missing timestamp, malformed versions, duplicate IDs, and equal-priority entries.
- [ ] Run `node --test test/catalog.test.mjs test/model-discovery.test.mjs`; confirm ranking assertions fail.
- [ ] Implement a policy that uses `created` only when supplied, otherwise parses family and numeric version parts. Use explicit provider priority, capabilities, provider ID, and canonical slug as tie-breakers. Never derive recency from a fabricated timestamp.
- [ ] Recalculate SOTA visibility from the current merged catalog. Keep older compatible routes routable and hidden rather than deleting them.
- [ ] Run the same command twice against the same fixture and require byte-identical order and PASS.
- [ ] Commit independently: `git add src/curate-models.mjs src/catalog.mjs src/model-registry.mjs test && git commit -m "feat: rank live model catalog deterministically"`.

### Task 3: Native config catalog, selection, and full restart

**Files:**
- Modify: `src/config-manager.mjs`, `src/control.mjs`, `src/router.mjs`, `src/providers.mjs`
- Test: `test/config-manager.test.mjs`, `test/control.test.mjs`, `test/router-health.test.mjs`

**Interfaces:**
- `control model-catalog --json -> CatalogSnapshot`
- `writeModelCatalogJson(snapshot) -> void`
- `control model-set <canonicalSlug> -> SelectionResult`
- `control codex-restart -> RestartResult`
- `setNextTaskModel(slug, { restart }) -> SelectionResult`

- [ ] Add tests for native and external entries in `model_catalog_json`, atomic `config.toml` writes, disabled-provider enablement, failed rebuild rollback, `restart: false`, and `restart: true`.
- [ ] Snapshot the current model, provider mode, ChatGPT login, MCP configuration, skills, and protected credential paths. Assert they are unchanged after selection tests.
- [ ] Run `node --test test/config-manager.test.mjs test/control.test.mjs test/router-health.test.mjs`; confirm the new cases fail.
- [ ] Implement generated `model_catalog_json` in the user `config.toml`. The native switcher gets the catalog only after a full restart. Do not edit Desktop source or pass credentials in arguments.
- [ ] Show `catalogUpdatedAt`, `restartRequired`, and the selected model in the snapshot. `restart: false` leaves Codex running; `restart: true` calls the existing graceful full-restart path only after the atomic write succeeds.
- [ ] Run the same command and require PASS with unchanged protected-state snapshots.
- [ ] Commit independently: `git add src test && git commit -m "feat: expose catalog through Codex config"`.

### Task 4: Native profile preservation and selected external subagents

**Files:**
- Modify: `src/codex-agent-catalog.mjs`, `src/catalog.mjs`, `src/model-registry.mjs`
- Test: `test/codex-agent-catalog.test.mjs`, `test/catalog.test.mjs`

**Interfaces:**
- `preserveNativeAgentProfiles(existingCatalog) -> AgentProfileCatalog`
- `rebuildExternalSubagentProfiles({ mergedCatalog, selectedProfiles }) -> AgentProfileCatalog`
- `isCompatibleExternalSubagent(model, profile) -> boolean`

- [ ] Add fixtures proving native Sol and Luna remain unchanged, a compatible external model becomes a selected subagent route, and an incompatible model is excluded.
- [ ] Run `node --test test/codex-agent-catalog.test.mjs test/catalog.test.mjs`; confirm the new cases fail.
- [ ] Implement capability-based external profile generation. Read native Sol and Luna from the existing Codex catalog; do not generate replacement TOML profiles for them.
- [ ] Rebuild only selected external profiles against the same catalog generation exposed to the switcher. Keep native IDs, display names, and role settings stable.
- [ ] Run the same command and require PASS with stable ordering and no native profile replacement.
- [ ] Commit independently: `git add src test && git commit -m "feat: add compatible external subagents"`.

### Task 5: Fresh Model Picker snapshot and macOS integration

**Files:**
- Modify: `apps/macos/ModelPicker/main.m`, `apps/macos/ModelRouterTray/Sources/ModelRouterTrayApp.swift`, `apps/macos/ModelRouterTray/Sources/ModelSelectorModels.swift`
- Test: `test/macos-model-picker.test.mjs`, `apps/macos/ModelRouterTray/Tests/ModelRouterTrayTests/ModelSelectorModelsTests.swift`

**Interfaces:**
- `loadCatalogSnapshot() -> CatalogSnapshot`
- `ModelSelectorCatalog.models(for:search:) -> [ModelSelectorEntry]`
- `selectModel(slug, restart) -> SelectionResult`

- [ ] Add fixtures showing native OpenAI and current external entries in the Model Picker's existing sections, plus one SOTA section, with `catalogUpdatedAt` and `restartRequired` visible.
- [ ] Run `node --test test/macos-model-picker.test.mjs` and `swift test --package-path apps/macos/ModelRouterTray`; confirm the new cases fail.
- [ ] Feed the Model Picker and tray from the fresh control snapshot without removing existing lists or sections. Keep credentials out of Swift state.
- [ ] Add `Later` and `Restart` actions. `Later` saves the next-task model and leaves Codex running. `Restart` performs the full graceful restart only after user choice. Show a clear notice when a newer catalog requires restart.
- [ ] Run `node --test test/macos-model-picker.test.mjs`, `swift test --package-path apps/macos/ModelRouterTray`, and `swift build -c release --package-path apps/macos/ModelRouterTray`; require PASS and exit 0.
- [ ] Commit independently: `git add apps/macos test && git commit -m "feat: refresh Model Picker from catalog"`.

### Task 6: Verified checkout, new repository, release, and documentation

**Files:**
- Modify: `src/target-integration.mjs`, `src/install-manifest.mjs`, `src/tray-install.mjs`, `README.md`, `docs/INSTALL.md`, `docs/DESKTOP-TRAY.md`, `docs/MACOS-TRAY.md`
- Test: `test/update-target.test.mjs`, `test/tray-install.test.mjs`, and all targeted tests from Tasks 1 through 5
- Create in the new target repository `codex-router-dynamic-model-catalog`: `LICENSE` with MIT text, `NOTICE.md` with upstream attribution, `.github/workflows/ci.yml` for Node/Swift tests and secret scanning, and `.github/workflows/release.yml` for verifiable build artifacts.

**Interfaces:**
- `resolveActiveStableCheckout() -> { activePath, stablePath, commit }`
- `installVerifiedCommit({ checkout, commit, target }) -> InstallResult`
- `buildReleaseArtifacts() -> Array<{ path, sha256 }>`

- [ ] Add tests that reject an active/stable checkout mismatch, reject installation from a dirty or unverified commit, and accept installation only when both paths resolve to the same verified commit.
- [ ] Run `node --test test/update-target.test.mjs test/tray-install.test.mjs`; confirm the new cases fail.
- [ ] Implement active/stable checkout alignment and install from one verified commit. Record the commit SHA and artifact checksums before any release push.
- [ ] Update documentation for LKG age/state, launchd backoff, lock behavior, `model_catalog_json`, full restart choice, Model Picker continuity, native Sol/Luna ownership, and selected external profiles.
- [ ] Create `codex-router-dynamic-model-catalog` in the authenticated user's GitHub account. Add upstream attribution in `NOTICE.md`, MIT in `LICENSE`, CI with `npm test` and `swift test`, and a redacted `gitleaks` scan.
- [ ] Build release artifacts with `./scripts/build-macos-model-picker.sh`, `./scripts/build-macos-tray-app.sh`, and `./scripts/build-desktop-tray.sh`. Upload them from the release workflow with SHA-256 checksums.
- [ ] Run `git diff --check`, all targeted tests, the secret scan, and artifact checksum verification. Inspect the generated catalog, native Sol/Luna IDs, Model Picker sections, and restart notice.
- [ ] Push only the verified commit and tag after checks pass:

```sh
GH_USER="$(gh api user --jq .login)"
gh repo create "$GH_USER/codex-router-dynamic-model-catalog" --private --source . --remote origin --push=false
git push origin HEAD:main
git push origin "$(git describe --tags --exact-match HEAD)"
```

- [ ] Commit independently: `git add src README.md docs test .github LICENSE NOTICE.md && git commit -m "release: publish dynamic model catalog"`.
