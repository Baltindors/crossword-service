// src/utils/poolsStore.js
import fs from "fs/promises";

export const DATA_DIR = "src/data";
export const POOLS_PATH = `${DATA_DIR}/pools.json`;
export const GRID_MAX = 12;
const OK = /^[A-Z0-9_]+$/;

export function normalizeToken(w) {
  return String(w || "")
    .toUpperCase()
    .replace(/\s+/g, "");
}

function dedupeAlpha(arr) {
  return [...new Set(arr)].sort((a, b) => a.localeCompare(b));
}

function emptyPools() {
  const o = {};
  for (let L = 3; L <= GRID_MAX; L++) o[String(L)] = [];
  return o;
}

export async function loadPoolsSafe() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(POOLS_PATH, "utf8");
    const obj = JSON.parse(raw) || {};
    // Ensure the structure is a flat array for each length
    for (let L = 3; L <= GRID_MAX; L++) {
      const key = String(L);
      const arr = Array.isArray(obj[key]) ? obj[key] : [];
      obj[key] = dedupeAlpha(
        arr.map(normalizeToken).filter((w) => OK.test(w) && w.length === L)
      );
    }
    return obj;
  } catch {
    const fresh = emptyPools();
    await savePoolsAtomic(fresh);
    return fresh;
  }
}

export async function savePoolsAtomic(poolsObj) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${POOLS_PATH}.tmp`;
  const bak = `${POOLS_PATH}.bak`;
  try {
    await fs.writeFile(tmp, JSON.stringify(poolsObj, null, 2));
    try {
      await fs.rename(POOLS_PATH, bak);
    } catch {} // Ignore error if bak fails (e.g., first run)
    await fs.rename(tmp, POOLS_PATH);
  } catch (error) {
    console.error(`[poolsStore] Failed to save pools file: ${error.message}`);
  }
}

export function addWordsToPools(poolsObj, words) {
  const added = {};
  for (const raw of words || []) {
    const w = normalizeToken(raw);
    if (!OK.test(w)) continue;
    const L = w.length;
    if (L < 3 || L > GRID_MAX) continue;

    const key = String(L);
    poolsObj[key] = poolsObj[key] || []; // Ensure array exists

    // Use a Set for faster `has` check before pushing
    const wordSet = new Set(poolsObj[key]);
    if (!wordSet.has(w)) {
      poolsObj[key].push(w);
      added[key] = (added[key] || 0) + 1;
    }
  }
  // Tidy (dedupe/sort) all modified buckets
  for (const key in added) {
    poolsObj[key] = dedupeAlpha(poolsObj[key]);
  }
  return added; // e.g., { "3": 12, "4": 7, ... }
}
