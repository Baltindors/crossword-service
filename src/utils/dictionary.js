const OK = /^[A-Z0-9_]+$/;

/**
 * Fetch top candidates of a specific length from OneLook.
 * - topic: semantic seed ("HIV Prevention")
 * - length: exact number of chars required
 * - max: how many to request (we'll still sanitize & dedupe)
 */
export async function fetchOnelookByLength({ topic, length, max = 60 }) {
  const sp = "?".repeat(length); // exact length mask
  const url = `https://api.onelook.com/words?ml=${encodeURIComponent(
    topic
  )}&topics=medical&sp=${sp}&max=${max}`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn("OneLook error", res.status, await res.text());
    return [];
  }

  /** expected shape: [{ word: "descovy", score: 1234 }, ...] */
  const raw = await res.json();

  // sort by score (desc), sanitize, dedupe
  const seen = new Set();
  const out = [];
  for (const item of (raw || []).sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0)
  )) {
    const w = String(item?.word || "")
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!OK.test(w)) continue;
    if (w.length !== length) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/**
 * Build pools for multiple lengths at once.
 * Returns a Map<number, string[]> where key = length.
 */
export async function buildCandidatePools({ topic, lengths, perLength = 20 }) {
  const uniq = Array.from(new Set(lengths)).sort((a, b) => a - b);
  const pools = new Map();

  await Promise.all(
    uniq.map(async (L) => {
      const list = await fetchOnelookByLength({
        topic,
        length: L,
        max: perLength * 3,
      });
      pools.set(L, list.slice(0, perLength)); // keep the best N
    })
  );

  return pools;
}
