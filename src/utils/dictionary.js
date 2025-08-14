// src/utils/dictionary.js
import fs from "fs/promises";
import {
  loadPoolsSafe,
  savePoolsAtomic,
  addWordsToPools,
} from "./poolsStore.js";

const OK = /^[A-Z0-9_]+$/;

const up = (s) =>
  String(s || "")
    .toUpperCase()
    .replace(/\s+/g, "");
const dedupeAlpha = (arr) =>
  [...new Set(arr)].sort((a, b) => a.localeCompare(b));

// -------- Remote fetchers --------
export async function fetchOnelookByLength({
  topic,
  length,
  max = 200,
  topicsHints = [],
}) {
  const sp = "?".repeat(length);
  const qs = new URLSearchParams();
  if (topic) qs.set("ml", topic);
  qs.set("sp", sp);
  if (topicsHints?.length) qs.set("topics", topicsHints.join(","));
  qs.set("max", String(max));

  const url = `https://api.onelook.com/words?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn("[OneLook]", res.status, await res.text());
    return [];
  }
  const raw = await res.json();
  const seen = new Set();
  const out = [];
  for (const item of (raw || []).sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0)
  )) {
    const w = up(item?.word);
    if (!OK.test(w) || w.length !== length) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

export async function fetchDatamuseByLength({
  topic,
  length,
  max = 1000,
  topicsHints = [],
}) {
  const sp = "?".repeat(length);
  const qs = new URLSearchParams();
  qs.set("sp", sp);
  if (topic) qs.set("ml", topic);
  if (topicsHints?.length) qs.set("topics", topicsHints.join(","));
  qs.set("max", String(max));

  const url = `https://api.datamuse.com/words?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn("[Datamuse]", res.status, await res.text());
    return [];
  }
  const raw = await res.json();
  const seen = new Set();
  const out = [];
  for (const item of raw || []) {
    const w = up(item?.word);
    if (!OK.test(w) || w.length !== length) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

// Optional local lists (if you add them later)
async function loadLocalWordlists() {
  async function readList(p) {
    try {
      return (await fs.readFile(p, "utf8"))
        .split(/\r?\n/)
        .map(up)
        .filter((w) => w && OK.test(w));
    } catch {
      return [];
    }
  }
  const medical = await readList("src/dicts/wordlist-medical.txt");
  const general = await readList("src/dicts/wordlist-general.txt");
  return { medical: dedupeAlpha(medical), general: dedupeAlpha(general) };
}

/**
 * Build pools for requested lengths and PERSIST any new words to pools.json.
 * Strategy:
 *  - L<=4: general vocab (short medical is sparse) with large oversample
 *  - L>=5: medical/health/HIV-prevention hints
 *  - Datamuse fallback if OneLook thin
 *  - Optional local top-ups
 * Returns Map<length, string[]> where each array is the top `perLength` slice
 * from the **on-disk** (ever-growing) pool.
 */
export async function buildCandidatePools({ topic, lengths, perLength = 50 }) {
  const uniq = Array.from(new Set(lengths)).sort((a, b) => a - b);
  const onDisk = await loadPoolsSafe();
  const local = await loadLocalWordlists();
  const result = new Map();

  for (const L of uniq) {
    const isShort = L <= 4;
    const isSix = L === 6;

    const target = perLength;
    const oneLookMax = isShort
      ? Math.max(400, target * 8)
      : isSix
      ? Math.max(200, target * 4)
      : Math.max(160, target * 3);
    const datamuseMax = isShort
      ? Math.max(800, target * 12)
      : Math.max(400, target * 6);
    const medTopics = ["medical", "health", "hiv", "prevention"];
    const topicsHints = isShort ? [] : medTopics;

    // 1) OneLook
    let fetched = await fetchOnelookByLength({
      topic,
      length: L,
      max: oneLookMax,
      topicsHints,
    });

    // 2) Datamuse fallback
    if (fetched.length < target) {
      const dm = await fetchDatamuseByLength({
        topic,
        length: L,
        max: datamuseMax,
        topicsHints,
      });
      fetched = dedupeAlpha([...fetched, ...dm]);
    }

    // 3) Top up from local lists if needed
    if (fetched.length < target) {
      const filler = (isShort ? local.general : local.medical).filter(
        (w) => w.length === L
      );
      fetched = dedupeAlpha([...fetched, ...filler]);
    }

    // 4) Merge into on-disk pools (append-only)
    addWordsToPools(onDisk, fetched);

    // 5) Solver slice comes from on-disk pool (stable + growing)
    const bucket = onDisk[String(L)] || [];
    result.set(L, bucket.slice(0, target));
  }

  // Persist growth atomically
  await savePoolsAtomic(onDisk);

  return result;
}
