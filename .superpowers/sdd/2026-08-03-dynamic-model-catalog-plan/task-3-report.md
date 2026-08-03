# Task 3 report

## Status

Focused tests pass: 30/30.

The requested full `npm test` run was started but interrupted by the user when the 8-minute limit ended. Its result is therefore not claimed.

## Implemented

- `control model-catalog --json` reads the merged catalog and returns models, `catalogUpdatedAt`, selected model, and `restartRequired`.
- Router `v1/models` preserves its existing payload and adds `catalogUpdatedAt` when present.
- `model-set` accepts `--restart=true|false`, writes the model through the existing atomic config path, and restarts only after a successful write.
- Provider selection, config, merged catalog, and native aliases are restored atomically on a failed catalog/config/restart step.
- Restart uses direct process arguments only. The test override validates JSON string arguments. Production uses the macOS graceful quit/reopen path.

## Verification

`node --test test/control.test.mjs test/router-health.test.mjs test/config-manager.test.mjs`

- 30 passed
- 0 failed

`npm test`

- interrupted by the user before completion

No Codex Desktop source, MCP, skills, credential files, or generated managed catalog path was changed.

## Fix round 1

Implemented targeted hardening:

- Removed arbitrary restart command and argument environment overrides.
- Test restart uses only a fixed marker file write. Production uses fixed direct `osascript` and `open` arguments with an empty environment.
- Added explicit `codex-restart` and `setNextTaskModel` mapping.
- Bare `--restart` now returns the usage error.
- Catalog writes now include `catalogUpdatedAt` with `models`.
- Rollback snapshots and restores managed `router-model-*.toml` files with content and mode. New managed files are removed. User-owned agent files are preserved and never replaced.
- Added snapshots for credentials, auth, skills, MCP data, and unrelated TOML in the selection tests.

Verification:

`node --test test/control.test.mjs test/config-manager.test.mjs test/router-health.test.mjs test/catalog.test.mjs test/codex-agent-catalog.test.mjs`

- 42 passed
- 0 failed

`git diff --check` was run before commit. No real Codex restart, network, inference, or vendor-quota test was used.
