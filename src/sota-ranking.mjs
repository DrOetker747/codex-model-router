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

function priorityValue(model) {
  return typeof model?.priority === "number" && Number.isFinite(model.priority)
    ? model.priority
    : undefined;
}

function capabilityScore(model) {
  if (typeof model?.capabilityScore === "number" && Number.isFinite(model.capabilityScore)) {
    return model.capabilityScore;
  }
  if (Array.isArray(model?.capabilities)) {
    return new Set(model.capabilities.filter((value) => typeof value === "string")).size;
  }
  if (model?.capabilities && typeof model.capabilities === "object") {
    return Object.values(model.capabilities).filter((value) => value === true).length;
  }
  return undefined;
}

function providerValue(model) {
  const provider = typeof model?.provider === "string" ? model.provider.trim() : "";
  return provider || undefined;
}

function candidate(model) {
  const id = typeof model === "string" ? model.trim() : String(model?.id || "").trim();
  const parsed = parseModelFamilyAndVersion(id);
  return parsed ? {
    id,
    ...parsed,
    created: createdValue(model),
    priority: priorityValue(model),
    capabilityScore: capabilityScore(model),
    provider: providerValue(model),
  } : undefined;
}

function compareOptionalNumbers(left, right) {
  if (left !== undefined && right !== undefined && left !== right) return left > right ? 1 : -1;
  if (left !== undefined && right === undefined) return 1;
  if (left === undefined && right !== undefined) return -1;
  return 0;
}

function comparePriority(left, right) {
  if (left !== undefined && right !== undefined && left !== right) return left < right ? 1 : -1;
  if (left !== undefined && right === undefined) return 1;
  if (left === undefined && right !== undefined) return -1;
  return 0;
}

export function compareModelRecords(leftModel, rightModel) {
  const left = candidate(leftModel);
  const right = candidate(rightModel);
  if (!left || !right) {
    if (left) return 1;
    if (right) return -1;
    const leftId = typeof leftModel === "string" ? leftModel : String(leftModel?.id || "");
    const rightId = typeof rightModel === "string" ? rightModel : String(rightModel?.id || "");
    return -idCompare(leftId, rightId);
  }
  if (left.key !== right.key) return -idCompare(left.key, right.key);
  const version = compareModelVersions(left.versionParts, right.versionParts);
  if (version) return version;
  const created = compareOptionalNumbers(left.created, right.created);
  if (created) return created;
  const priority = comparePriority(left.priority, right.priority);
  if (priority) return priority;
  const capabilities = compareOptionalNumbers(left.capabilityScore, right.capabilityScore);
  if (capabilities) return capabilities;
  if (left.provider !== right.provider) {
    if (left.provider !== undefined && right.provider === undefined) return 1;
    if (left.provider === undefined && right.provider !== undefined) return -1;
    return -idCompare(left.provider, right.provider);
  }
  return -idCompare(left.id, right.id);
}

export function rankSotaModels(models) {
  const input = typeof models === "string" ? [models] : models || [];
  return [...input]
    .map(candidate)
    .filter(Boolean)
    .sort((left, right) => -compareModelRecords(left, right));
}

export function selectSotaModelIds(models) {
  const best = new Map();
  for (const item of rankSotaModels(models)) {
    if (!best.has(item.key)) best.set(item.key, item);
  }
  return new Set([...best.values()].map((item) => item.id).sort(idCompare));
}
