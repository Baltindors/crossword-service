// src/dictionary/indexes.js
import { RULES, normalizeToken } from "../config/rules.js";

/**
 * Shape expectations
 * ------------------
 * pools can be either of:
 * A) tiered (what we suggested writing to pools.json):
 * {
 * "5": { medical: ["VIRUS","SERUM",...], general: ["LOCAL","CHECK",...] },
 * "7": { medical: [...], general: [...] },
 * ...
 * }
 * B) flat (earlier version):
 * { "5": ["VIRUS","SERUM",...], "7": [...], ... }
 *
 * We normalize either shape into three maps:
 * - byLen.medical : Map<number, string[]>
 * - byLen.general : Map<number, string[]>
 * - byLen.both    : Map<number, string[]>  (union, deduped, sorted)
 *
 * And a position index per tier:
 * - posIndex.medical.get(L) -> Array<Map<char, Set<word>>> length L
 * - posIndex.general.get(L) -> ...
 * - posIndex.both.get(L)    -> ...
 */

// ---------- Build indexes ----------

/**
 * Build word indexes for all tiers.
 * @param {object|Map} pools
 * @param {object} [opts]
 * @param {boolean} [opts.logs=false]  // when true, logs coverage by length per tier
 */
export function buildTieredIndexes(pools, { logs = false } = {}) {
  const { medicalByLen, generalByLen } = coercePoolsToTiered(pools);

  // determinism: sort alpha + dedupe
  const byLen = {
    medical: sortAndDedupeMap(medicalByLen),
    general: sortAndDedupeMap(generalByLen),
    both: new Map(),
  };

  // union for "both"
  for (const L of new Set([...byLen.medical.keys(), ...byLen.general.keys()])) {
    const a = byLen.medical.get(L) || [];
    const b = byLen.general.get(L) || [];
    byLen.both.set(L, dedupeAlpha([...a, ...b]));
  }

  if (logs) {
    logCoverageByLength({ label: "medical", map: byLen.medical });
    logCoverageByLength({ label: "general", map: byLen.general });
    logCoverageByLength({ label: "both   ", map: byLen.both });
  }

  // position indexes
  const posIndex = {
    medical: buildPosIndex(byLen.medical),
    general: buildPosIndex(byLen.general),
    both: buildPosIndex(byLen.both),
  };

  return { byLen, posIndex };
}

/** Coerce incoming pools (tiered or flat) into two maps: medical & general. */
function coercePoolsToTiered(pools) {
  const medicalByLen = new Map();
  const generalByLen = new Map();

  // If it's a Map, turn to entries array; if plain object, use Object.entries
  const entries =
    pools instanceof Map ? [...pools.entries()] : Object.entries(pools);

  for (const [k, v] of entries) {
    const L = Number(k);
    if (!Number.isFinite(L)) continue;

    // Tiered case: { medical: [], general: [] }
    if (
      v &&
      typeof v === "object" &&
      (Array.isArray(v.medical) || Array.isArray(v.general))
    ) {
      const med = (v.medical || [])
        .map(normalizeToken)
        .filter(isValidTokenUnique());
      const gen = (v.general || [])
        .map(normalizeToken)
        .filter(isValidTokenUnique());
      if (med.length) medicalByLen.set(L, med);
      if (gen.length) generalByLen.set(L, gen);

      // Flat case: []
    } else if (Array.isArray(v)) {
      const arr = v.map(normalizeToken).filter(isValidTokenUnique());
      if (arr.length) {
        // assume flat arrays are "medical" tier for now (older pipeline)
        medicalByLen.set(L, arr);
      }
    }
  }

  return { medicalByLen, generalByLen };
}

/** Helper to filter only valid tokens and dedupe within a single call. */
function isValidTokenUnique() {
  const seen = new Set();
  return (w) => {
    if (!RULES.tokenRegex.test(w)) return false;
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  };
}

/** Return a new Map with each array sorted alpha & deduped. */
function sortAndDedupeMap(m) {
  const out = new Map();
  for (const [L, arr] of m.entries()) {
    out.set(L, dedupeAlpha(arr));
  }
  return out;
}

function dedupeAlpha(arr) {
  return [...new Set(arr)].sort((a, b) => a.localeCompare(b));
}

/** Build posIndex for each length: Array< Map<char, Set<word>> > of length L */
function buildPosIndex(byLenMap) {
  const pos = new Map();
  for (const [L, words] of byLenMap.entries()) {
    const arr = Array.from({ length: L }, () => new Map());
    for (const w of words) {
      // assume w.length === L; if not, skip
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
  // compact ascending-by-length log (e.g., {3: 152, 4: 819, 5: 1211, ...})
  const ordered = Object.fromEntries(
    Object.entries(counts).sort((a, b) => Number(a[0]) - Number(b[0]))
  );
  console.log(`[dict] pool sizes by length (${label}):`, ordered);
}

// ---------- Query: pattern → candidates ----------

/**
 * Return candidates matching a pattern for a given length and tier.
 *
 * @param {object} indexes    result of buildTieredIndexes()
 * @param {number} length     slot length
 * @param {string} pattern    e.g., "__A_E__" using RULES.unknownChar for wildcards
 * @param {object} opts
 * - tier: "medical" | "general" | "both" (default "medical")
 * - limit: number (cap results; default Infinity)
 * - order: "alpha" | "asIs" (default "alpha") // alpha is deterministic
 * @returns {string[]} candidates
 */
export function candidatesForPattern(indexes, length, pattern, opts = {}) {
  const { tier = "medical", limit = Infinity, order = "alpha" } = opts;

  if (typeof pattern !== "string" || pattern.length !== length) return [];
  if (!indexes?.byLen?.[tier] || !indexes?.posIndex?.[tier]) return [];

  const byLen = indexes.byLen[tier];
  const posIndex = indexes.posIndex[tier];

  const words = byLen.get(length) || [];
  if (words.length === 0) return [];

  const pos = posIndex.get(length);
  if (!pos) return [];

  // Collect constraints: indices where pattern has a fixed character
  const constraints = [];
  for (let i = 0; i < length; i++) {
    const ch = pattern[i];
    if (ch !== RULES.unknownChar) {
      if (!RULES.tokenRegex.test(ch)) return []; // invalid char
      constraints.push([i, ch]);
    }
  }

  // If no fixed letters, return whole pool (respect order/limit)
  if (constraints.length === 0) {
    const out = order === "alpha" ? [...words] : words.slice();
    return out.slice(0, limit);
  }

  // Intersect sets; start with the smallest bucket to reduce work
  constraints.sort((a, b) => {
    const sizeA = pos[a[0]].get(a[1])?.size ?? 0;
    const sizeB = pos[b[0]].get(b[1])?.size ?? 0;
    return sizeA - sizeB;
  });

  let current = null; // Set<string>
  for (const [i, ch] of constraints) {
    const bucket = pos[i].get(ch);
    if (!bucket || bucket.size === 0) {
      return [];
    }
    if (current === null) {
      current = new Set(bucket);
    } else {
      // set intersection
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

/**
 * Utility: build a pattern string from partial letters.
 * fixedLetters: Array<[index, char]> or Map<index,char> or object { [idx]:char }
 */
export function patternFromFixed(length, fixedLetters) {
  const arr = Array.from({ length }, () => RULES.unknownChar);
  if (!fixedLetters) return arr.join("");

  if (Array.isArray(fixedLetters)) {
    for (const [i, ch] of fixedLetters) {
      if (i >= 0 && i < length)
        arr[i] = normalizeToken(ch)[0] || RULES.unknownChar;
    }
  } else if (fixedLetters instanceof Map) {
    for (const [i, ch] of fixedLetters.entries()) {
      if (i >= 0 && i < length)
        arr[i] = normalizeToken(ch)[0] || RULES.unknownChar;
    }
  } else if (typeof fixedLetters === "object") {
    for (const k of Object.keys(fixedLetters)) {
      const i = Number(k);
      if (!Number.isFinite(i)) continue;
      if (i >= 0 && i < length)
        arr[i] = normalizeToken(fixedLetters[k])[0] || RULES.unknownChar;
    }
  }
  return arr.join("");
}

/** Convenience getter: return array for a tier+length (empty if missing). */
export function getByLen(indexes, tier, length) {
  return indexes?.byLen?.[tier]?.get(length) || [];
}
