# Dynamic Model Catalog Design

## Goal

Make the local catalog follow the live catalogs of all enabled providers while preserving the existing Model Picker, native Codex models, and Codex state.

## Approved solution

- Keep the existing Model Picker and all its current sections and lists. Feed it a fresh merged snapshot. SOTA is one section, not the whole picker.
- Generate `model_catalog_json` in the user Codex `config.toml`. After a full Codex Desktop restart, the native switcher reads that generated catalog and shows native OpenAI plus current external models. No Codex Desktop source is assumed or changed.
- Synchronize every enabled provider with a regular `launchd` job. Use bounded exponential backoff, single-flight locking, and atomic LKG writes.
- Keep `qwen3.8-max` when the live catalog returns that canonical ID.
- Calculate SOTA only from live valid metadata or explicitly labelled LKG data. Use real `created` metadata when present. When it is absent, use deterministic version and family parsing under an explicit policy. Never invent recency.
- Store a per-provider LKG payload, fetch time, age, and state: `fresh`, `stale`, `unavailable`, or `invalid`.
- Rebuild the merged catalog after sync. Preserve native Sol and Luna models owned by OpenAI/Codex. Generate only selected compatible external subagent profiles.
- Preserve ChatGPT login, MCP servers, skills, credentials, provider settings, and unrelated Codex configuration. Never restart Codex without an explicit user choice.
- Use fixtures and cheap or free live checks. Paid live tests require explicit approval.

## Runtime flow

1. The `launchd` job acquires the single-flight lock and reads enabled providers.
2. It fetches and validates each live catalog, applying backoff on failure.
3. It writes a successful LKG record atomically, or exposes the previous record with its age and state.
4. It merges providers, ranks SOTA, preserves native profiles, and rebuilds selected external subagent profiles.
5. It writes `model_catalog_json` atomically to `config.toml` and refreshes the Model Picker snapshot.
6. The UI shows when the catalog is newer and that a restart is required. The user chooses whether to restart Codex.

## Release boundary

Finalization includes one verified active/stable checkout, installation from one verified commit, and publication to a new user-owned GitHub repository with upstream attribution, MIT licensing, secret scanning, CI, release artifacts, and a push only after verification.

## Safety boundary

A failed fetch, merge, profile rebuild, config write, selection, or restart keeps the previous working state. Credentials stay in protected storage and never enter UI state or command arguments.
