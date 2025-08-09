// Pairs topic words by identical length, returns pairs + unpaired,
// and how many words are missing to reach a target total (default 10).

/**
 * Normalize a word for pairing rules.
 * - Uppercase
 * - Remove spaces
 * - Allow A–Z and underscores (medical conventions like CD4_COUNT)
 * - Returns null if invalid after cleanup.
 */
export function sanitizeWord(word) {
  if (!word || typeof word !== "string") return null;
  const cleaned = word.toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z_]+$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Pair words by identical length.
 * @param {string[]} words - raw words from config
 * @returns {{pairs: [string, string][], unpaired: string[], errors: string[]}}
 */
export function pairWordsByLength(words) {
  const errors = [];
  const sanitized = [];
  const seen = new Set();

  for (const w of words) {
    const s = sanitizeWord(w);
    if (!s) {
      errors.push(`Invalid word skipped: "${w}"`);
      continue;
    }
    sanitized.push(s);
  }

  // group by length
  const byLen = new Map(); // len -> string[]
  for (const w of sanitized) {
    const len = w.length;
    if (!byLen.has(len)) byLen.set(len, []);
    byLen.get(len).push(w);
  }

  // make pairs
  const pairs = [];
  const unpaired = [];
  for (const [len, arr] of byLen.entries()) {
    // stable order pairing
    for (let i = 0; i < arr.length; i += 2) {
      if (i + 1 < arr.length) {
        pairs.push([arr[i], arr[i + 1]]);
      } else {
        unpaired.push(arr[i]);
      }
    }
  }

  return { pairs, unpaired, errors };
}

/**
 * Analyze topic words against a target total count (default 10 = 5 pairs).
 * @param {string[]} topicWords
 * @param {number} targetTotal
 * @returns {{
 *   pairs: [string, string][],
 *   unpaired: string[],
 *   counts: { total:number, pairsCount:number, unpairedCount:number, missingToTarget:number },
 *   errors: string[]
 * }}
 */
export function analyzeTopicWords(topicWords, targetTotal = 10) {
  const { pairs, unpaired, errors } = pairWordsByLength(topicWords);
  const uniqueCount = pairs.length * 2 + unpaired.length;
  const missingToTarget = Math.max(0, targetTotal - uniqueCount);

  return {
    pairs,
    unpaired,
    counts: {
      total: uniqueCount,
      pairsCount: pairs.length,
      unpairedCount: unpaired.length,
      missingToTarget, // how many more words are needed to reach 10 total
    },
    errors,
  };
}
