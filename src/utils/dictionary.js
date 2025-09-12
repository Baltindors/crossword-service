// src/utils/dictionary.js
import fs from "fs/promises";
import {
  loadPoolsSafe,
  savePoolsAtomic,
  addWordsToPools,
} from "./poolsStore.js";
import { fetchOneLookByPattern } from "../solver/onelook.js";

const OK = /^[A-Z0-9_]+$/;

const up = (s) =>
  String(s || "")
    .toUpperCase()
    .replace(/\s+/g, "");
const dedupeAlpha = (arr) =>
  [...new Set(arr)].sort((a, b) => a.localeCompare(b));

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
 * - L<=4: general vocab (short medical is sparse) with large oversample
 * - L>=5: medical/health/HIV-prevention hints
 * - Optional local top-ups
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
    const target = perLength;
    const oneLookMax = isShort
      ? Math.max(400, target * 8)
      : Math.max(160, target * 3);

    const pattern = "?".repeat(L);
    // 1) OneLook
    let fetched = await fetchOneLookByPattern(pattern, {
      max: oneLookMax,
    });

    // 2) Top up from local lists if needed
    if (fetched.length < target) {
      const filler = (isShort ? local.general : local.medical).filter(
        (w) => w.length === L
      );
      fetched = dedupeAlpha([...fetched, ...filler]);
    }

    // 3) Merge into on-disk pools (append-only)
    addWordsToPools(onDisk, fetched);

    // 4) Solver slice comes from on-disk pool (stable + growing)
    const bucket = onDisk[String(L)] || [];
    result.set(L, bucket.slice(0, target));
  }

  // Persist growth atomically
  await savePoolsAtomic(onDisk);

  return result;
}
