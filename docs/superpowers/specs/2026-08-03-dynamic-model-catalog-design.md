# Dynamic Model Catalog Design

## Goal

Make the local model catalog follow the live catalogs of all enabled providers while keeping the existing Model Picker and native Codex behavior safe.

## Approved solution

- Keep the Model Picker. It remains the compact SOTA view.
- After a graceful Codex Desktop restart, the native switcher reads the merged catalog and shows native OpenAI models together with current external models.
- Synchronize every enabled provider. Normalize model IDs to canonical slugs. Include `qwen3.8-max` when the live catalog returns it.
- Calculate SOTA deterministically from the live catalog. Do not invent models or use stale data as a fresh result.
- Store a last-known-good cache per provider with the model payload, fetch time, age, and state: `fresh`, `stale`, `unavailable`, or `invalid`.
- Rebuild the merged catalog after sync. Rebuild only compatible subagent profiles that are selected by the capability rules.
- Keep Sol and Luna as root profiles. Add external models as compatible subagent routes without replacing the roots.
- Preserve ChatGPT login, MCP servers, skills, provider settings, and unrelated Codex configuration.
- Use fixtures and cheap or free live checks. Do not run paid live tests without explicit approval.
- Keep this implementation in the current repository. A separate repository is a later release decision.

## Runtime flow

1. Read the enabled provider set.
2. Fetch and validate each live catalog.
3. Write a successful response to its LKG cache, or expose the cache state and age when the fetch fails.
4. Merge valid provider entries, rank SOTA, and rebuild selected compatible agent profiles.
5. Expose the merged catalog to the Desktop switcher and the existing Model Picker.
6. Apply a selected model only to the next task. Restart Codex gracefully when requested.

## Safety boundary

Catalog failure must not delete the previous working configuration. A failed sync, merge, profile rebuild, model selection, or restart keeps the previous model and provider state. Credentials remain in the existing protected storage and never enter UI state or command arguments.
