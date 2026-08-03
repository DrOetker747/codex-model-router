const PATTERNS = [
  [/^kimi-k(\d+(?:\.\d+)*)(?:-.*)?$/i, "kimi", () => "standard"],
  [/^minimax-m(\d+(?:\.\d+)*)$/i, "minimax", () => "standard"],
  [/^grok-(\d+(?:\.\d+)*)$/i, "grok", () => "standard"],
  [/^glm-(\d+(?:\.\d+)*)$/i, "glm", () => "standard"],
  [/^gpt-(\d+(?:\.\d+)*)(?:-(luna))$/i, "gpt", (m) => m[2].toLowerCase()],
  [/^deepseek-v(\d+(?:\.\d+)*)(?:-(flash|pro))$/i, "deepseek", (m) => m[2].toLowerCase()],
  [/^qwen(\d+(?:\.\d+)*)(?:-(max|plus))$/i, "qwen", (m) => m[2].toLowerCase()],
  [/^mimo-v(\d+(?:\.\d+)*)(?:-(pro))?$/i, "mimo", (m) => m[2]?.toLowerCase() || "standard"],
  [/^hy(\d+(?:\.\d+)*)$/i, "hy", () => "standard"],
];

const idCompare = (a, b) => a === b ? 0 : a < b ? -1 : 1;

export function compareModelVersions(left, right) {
  const a = Array.isArray(left) ? left : String(left || "").split(".");
  const b = Array.isArray(right) ? right : String(right || "").split(".");
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = Number(a[i] || 0);
    const bv = Number(b[i] || 0);
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

export function parseModelFamilyAndVersion(id) {
  const value = typeof id === "string" ? id.trim() : "";
  for (const [pattern, family, variantOf] of PATTERNS) {
    const match = value.match(pattern);
    if (!match) continue;
    const variant = variantOf(match);
    return { family, key: `${family}:${variant}`, versionParts: match[1].split(".").map(Number), variant };
  }
  // Unknown IDs stay stored by sync, but are intentionally not SOTA.
  return undefined;
}

function createdValue(model) {
  if (!model || typeof model !== "object" || !("created" in model)) return undefined;
  if (typeof model.created === "number") return Number.isFinite(model.created) ? model.created : undefined;
  if (typeof model.created !== "string" || !model.created.trim()) return undefined;
  const numeric = Number(model.created);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(model.created);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function candidate(model) {
  const id = typeof model === "string" ? model.trim() : String(model?.id || "").trim();
  const parsed = parseModelFamilyAndVersion(id);
  return parsed ? { id, ...parsed, created: createdValue(model) } : undefined;
}

function compareCandidates(left, right) {
  const version = compareModelVersions(left.versionParts, right.versionParts);
  if (version) return version;
  if (left.created !== undefined && right.created !== undefined && left.created !== right.created) {
    return left.created > right.created ? 1 : -1;
  }
  if (left.created !== undefined && right.created === undefined) return 1;
  if (left.created === undefined && right.created !== undefined) return -1;
  return -idCompare(left.id, right.id);
}

export function selectSotaModelIds(models) {
  const input = typeof models === "string" ? [models] : models || [];
  const best = new Map();
  for (const item of [...input].map(candidate).filter(Boolean).sort((a, b) => idCompare(a.id, b.id))) {
    const current = best.get(item.key);
    if (!current || compareCandidates(item, current) > 0) best.set(item.key, item);
  }
  return new Set([...best.values()].map((item) => item.id).sort(idCompare));
}
