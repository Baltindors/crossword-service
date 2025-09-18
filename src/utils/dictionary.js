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

// Helper to load optional local wordlists
async function loadLocalWordlists() {
  async function readList(p) {
    try {
      return (await fs.readFile(p, "utf8"))
        .split(/\r?\n/)
        .map(up)
        .filter((w) => w && OK.test(w));
    } catch {
      return []; // Return empty array if file doesn't exist
    }
  }
  // This can be expanded to include medical or other specific lists if needed
  const general = await readList("src/data/wordlist-general.txt");
  return dedupeAlpha(general);
}

/**
 * Enriches the main pools.json with words from local text files.
 * This is now a pre-processing step, not a dynamic fetching step.
 * The solver will rely on the hydrator for API calls.
 */
export async function buildCandidatePools() {
  const onDiskPools = await loadPoolsSafe();
  const localWords = await loadLocalWordlists();

  if (localWords.length > 0) {
    console.log(
      `[Dictionary] Found ${localWords.length} words in local files to add to pools.`
    );
    addWordsToPools(onDiskPools, localWords);
    await savePoolsAtomic(onDiskPools);
  }

  return onDiskPools;
}
