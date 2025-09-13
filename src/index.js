// src/dictionary/indexes.js
import { RULES, normalizeToken } from "../config/rules.js";

/**
 * Build word indexes from a flat pool structure.
 *
 * @param {object} pools - e.g., { "3": ["CAT", "DOG"], "4": [...] }
 * @param {object} [opts]
 * @param {boolean} [opts.logs=false]
 * @returns {{byLen: Map<number, string[]>, posIndex: Map<number, Array<Map<string, Set<string>>>>}}
 */
export function buildTieredIndexes(pools, { logs = false } = {}) {
  const byLen = new Map();

  const entries =
    pools instanceof Map ? [...pools.entries()] : Object.entries(pools);

  for (const [k, v] of entries) {
    const L = Number(k);
    if (!Number.isFinite(L) || !Array.isArray(v)) continue;

    // Normalize, filter for valid tokens, dedupe, and sort
    const words = [
      ...new Set(v.map(normalizeToken).filter((w) => RULES.tokenRegex.test(w))),
    ].sort();
    if (words.length > 0) {
      byLen.set(L, words);
    }
  }

  if (logs) {
    logCoverageByLength({ label: "all words", map: byLen });
  }

  const posIndex = buildPosIndex(byLen);

  // Maintain the original return shape but without tiers for compatibility
  return {
    byLen: { both: byLen },
    posIndex: { both: posIndex },
  };
}

/** Build posIndex for each length: Array< Map<char, Set<word>> > of length L */
function buildPosIndex(byLenMap) {
  const pos = new Map();
  for (const [L, words] of byLenMap.entries()) {
    const arr = Array.from({ length: L }, () => new Map());
    for (const w of words) {
      if (w.length !== L) continue;
      for (let i = 0; i < L; i++) {
        const ch = w[i];
        let bucket = arr[i].get(ch);
        if (!bucket) {
          bucket = new Set();
          arr[i].set(ch, bucket);
        }
        bucket.add(w);
      }
    }
    pos.set(L, arr);
  }
  return pos;
}

function logCoverageByLength({ label, map }) {
  const counts = {};
  for (const [L, arr] of map.entries()) counts[L] = arr.length;
  const ordered = Object.fromEntries(
    Object.entries(counts).sort((a, b) => Number(a[0]) - Number(b[0]))
  );
  console.log(`[dict] pool sizes by length (${label}):`, ordered);
}

// ---------- Query: pattern → candidates ----------

/**
 * Return candidates matching a pattern.
 */
export function candidatesForPattern(indexes, length, pattern, opts = {}) {
  const { limit = Infinity, order = "alpha" } = opts;

  // Adjusted to work with the simplified index structure
  const tier = "both"; // We only have one pool now

  if (typeof pattern !== "string" || pattern.length !== length) return [];
  if (!indexes?.byLen?.[tier] || !indexes?.posIndex?.[tier]) return [];

  const byLen = indexes.byLen[tier];
  const posIndex = indexes.posIndex[tier];

  const words = byLen.get(length) || [];
  if (words.length === 0) return [];

  const pos = posIndex.get(length);
  if (!pos) return [];

  const constraints = [];
  for (let i = 0; i < length; i++) {
    const ch = pattern[i];
    if (ch !== RULES.unknownChar && ch !== "?") {
      // Allow both '_' and '?' as wildcards
      if (!RULES.tokenRegex.test(ch)) return [];
      constraints.push([i, ch]);
    }
  }

  if (constraints.length === 0) {
    const out = order === "alpha" ? [...words] : words.slice();
    return out.slice(0, limit);
  }

  constraints.sort((a, b) => {
    const sizeA = pos[a[0]].get(a[1])?.size ?? 0;
    const sizeB = pos[b[0]].get(b[1])?.size ?? 0;
    return sizeA - sizeB;
  });

  let current = null;
  for (const [i, ch] of constraints) {
    const bucket = pos[i].get(ch);
    if (!bucket || bucket.size === 0) return [];

    if (current === null) {
      current = new Set(bucket);
    } else {
      for (const w of current) {
        if (!bucket.has(w)) current.delete(w);
      }
      if (current.size === 0) return [];
    }
  }

  let out = [...current];
  if (order === "alpha") out.sort((a, b) => a.localeCompare(b));
  if (Number.isFinite(limit)) out = out.slice(0, limit);
  return out;
}
