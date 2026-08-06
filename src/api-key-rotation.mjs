import { readFileSync, renameSync, writeFileSync } from "node:fs";

// Upstream status codes that mean "this key is spent": rate limited (429),
// quota/payment exhausted (402) or rejected (401). Rotating to the next key
// slot is the intended recovery for all three.
export const ROTATE_ON_STATUS = new Set([401, 402, 429]);

// A key stays out of rotation for this long after it reports exhaustion.
export const EXHAUST_COOLDOWN_MS = 10 * 60 * 1000;

// Per-provider exhaustion and sticky-slot state. Exhaustion timestamps are
// persisted so a service restart does not hammer a spent key; the sticky
// "last used" slot is deliberately in-memory only (it is a hint, not state).
export function createRotationState(statePath) {
  let providers = {};
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    if (parsed?.version === 1 && parsed.providers) providers = parsed.providers;
  } catch {
    // A missing or corrupt state file means a fresh rotation.
  }
  const lastUsedByFamily = new Map();

  function record(family) {
    const entry = (providers[family] ||= { slots: [] });
    return entry;
  }

  function save() {
    try {
      const temporary = `${statePath}.tmp.${process.pid}`;
      writeFileSync(
        temporary,
        `${JSON.stringify({ version: 1, providers }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      renameSync(temporary, statePath);
    } catch {
      // Rotation state is best-effort; losing it only costs one request.
    }
  }

  return {
    exhaustedUntil(family, slot) {
      const entry = providers[family];
      return Number(entry?.slots?.[slot]?.exhaustedUntil || 0);
    },
    markExhausted(family, slot, cooldownMs = EXHAUST_COOLDOWN_MS) {
      const entry = record(family);
      while (entry.slots.length <= slot) entry.slots.push({ exhaustedUntil: 0 });
      entry.slots[slot].exhaustedUntil = Date.now() + cooldownMs;
      save();
    },
    markUsed(family, slot) {
      lastUsedByFamily.set(family, slot);
    },
    lastUsed(family) {
      return Number(lastUsedByFamily.get(family) ?? -1);
    },
    // Pick the next slot to try: the sticky last-used slot when it is still
    // available, otherwise the first slot whose cooldown has expired. When
    // every slot is cooling down, the least-recently exhausted one wins so a
    // spent key is retried (it may have recovered) instead of refusing work.
    nextSlot(family, slotCount, attempted = new Set()) {
      const lastUsed = this.lastUsed(family);
      if (lastUsed >= 0 && lastUsed < slotCount && !attempted.has(lastUsed)) {
        if (this.exhaustedUntil(family, lastUsed) <= Date.now()) return lastUsed;
      }
      let best = -1;
      let bestUntil = Number.POSITIVE_INFINITY;
      for (let slot = 0; slot < slotCount; slot += 1) {
        if (attempted.has(slot)) continue;
        const until = this.exhaustedUntil(family, slot);
        if (until <= Date.now()) return slot;
        if (until < bestUntil) {
          bestUntil = until;
          best = slot;
        }
      }
      return best;
    },
  };
}
