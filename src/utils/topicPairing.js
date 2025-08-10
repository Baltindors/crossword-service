// src/utils/topicPairing.js

/**
 * Normalize a word:
 * - Uppercase
 * - Remove spaces
 * - Allow A–Z, digits, underscores (e.g., CD4COUNT)
 * Returns null if invalid after cleanup.
 */
export function sanitizeWord(word) {
  if (!word || typeof word !== "string") return null;
  const cleaned = word.toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9_]+$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Build anchors with type annotation.
 * @param {string[]} themeWords
 * @param {string[]} topicWords
 * @returns {{word:string,length:number,type:'theme'|'topic'}[]}
 */
export function buildAnchors(themeWords = [], topicWords = []) {
  const them = (themeWords || [])
    .map(sanitizeWord)
    .filter(Boolean)
    .map((w) => ({ word: w, length: w.length, type: "theme" }));
  const top = (topicWords || [])
    .map(sanitizeWord)
    .filter(Boolean)
    .map((w) => ({ word: w, length: w.length, type: "topic" }));
  return [...them, ...top]; // THEME FIRST (important for placement later)
}

/**
 * Pair anchors with constraints:
 * - Apply fixedPairs first.
 * - Pair THEME ↔ TOPIC by identical length.
 * - Pair remaining TOPIC ↔ TOPIC by identical length.
 * - Never pair THEME ↔ THEME.
 *
 * @param {{word:string,length:number,type:'theme'|'topic'}[]} anchors (theme first)
 * @param {[string,string][]} fixedPairs (already uppercased or raw; sanitized internally)
 * @returns {{
 *   pairs: [string,string][],
 *   unpaired: string[],
 *   excludeWords: string[],
 *   anchorsNeedingPartners: {word:string,length:number}[],
 *   counts: { anchors:number, paired:number, unpaired:number }
 * }}
 */
export function pairAnchorsWithConstraints(anchors, fixedPairs = []) {
  const byWord = new Map(anchors.map((a) => [a.word, a]));
  const taken = new Set();
  const pairs = [];

  // sanitize fixed pairs
  const fixed = [];
  for (const [a, b] of fixedPairs || []) {
    const A = sanitizeWord(a),
      B = sanitizeWord(b);
    if (A && B) fixed.push([A, B]);
  }

  // 1) apply fixed pairs first
  for (const [a, b] of fixed) {
    if (byWord.has(a) && byWord.has(b) && !taken.has(a) && !taken.has(b)) {
      pairs.push([a, b]);
      taken.add(a);
      taken.add(b);
    }
  }

  // remaining anchors
  const left = anchors.filter((a) => !taken.has(a.word));

  // group remaining by length, separated by type
  const byLenTheme = new Map();
  const byLenTopic = new Map();
  for (const a of left) {
    const bucket = a.type === "theme" ? byLenTheme : byLenTopic;
    if (!bucket.has(a.length)) bucket.set(a.length, []);
    bucket.get(a.length).push(a.word);
  }
  // sort alphabetically within each same-length bucket (deterministic pairing)

  // 2) pair THEME ↔ TOPIC by equal length
  for (const [len, themes] of byLenTheme.entries()) {
    const topics = (byLenTopic.get(len) || []).filter((w) => !taken.has(w));
    let j = 0;
    for (const th of themes) {
      if (taken.has(th)) continue;
      while (j < topics.length && taken.has(topics[j])) j++;
      if (j >= topics.length) break;
      const tp = topics[j++];
      pairs.push([th, tp]);
      taken.add(th);
      taken.add(tp);
    }
  }

  // 3) pair remaining TOPIC ↔ TOPIC by equal length
  for (const [len, topics] of byLenTopic.entries()) {
    const pool = topics.filter((w) => !taken.has(w));
    for (let i = 0; i + 1 < pool.length; i += 2) {
      const a = pool[i],
        b = pool[i + 1];
      if (taken.has(a) || taken.has(b)) continue;
      pairs.push([a, b]);
      taken.add(a);
      taken.add(b);
    }
  }

  // 4) leftovers are unpaired (includes any THEME that didn't find a TOPIC)
  const unpaired = anchors.map((a) => a.word).filter((w) => !taken.has(w));

  // Exclusions for AI (don’t reuse these)
  const excludeSet = new Set([...anchors.map((a) => a.word), ...pairs.flat()]);

  // The anchors that still need NEW partners from AI
  const anchorsNeedingPartners = anchors
    .filter((a) => !taken.has(a.word))
    .map((a) => ({ word: a.word, length: a.length }));

  return {
    pairs,
    unpaired,
    excludeWords: Array.from(excludeSet),
    anchorsNeedingPartners,
    counts: {
      anchors: anchors.length,
      paired: pairs.length * 2,
      unpaired: anchorsNeedingPartners.length,
    },
  };
}
