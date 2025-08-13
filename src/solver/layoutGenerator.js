// src/solver/layoutGenerator.js
import {
  makeEmptyGrid,
  mirrorOf,
  placeBlockSym,
  removeBlockSym,
  validateGridBasic,
  getAcrossRuns,
  getDownRuns,
} from "../grid/gridModel.js";
import { RULES } from "../config/rules.js";

/**
 * Create an initial symmetric layout by inserting symmetric block pairs
 * into the longest runs until we reach the target block budget.
 *
 * Strategy (deterministic, no randomness):
 * - Start from an empty grid (all white).
 * - Repeatedly pick the current longest slot (across/down) with length >= 2*minEntryLen+1.
 * - Insert a symmetric block pair roughly at its center (respecting reserved cells).
 * - Only accept placements that keep: 180° symmetry, no 2-letter entries, connectivity.
 *
 * @param {object} params
 *  - size: number (e.g., 12)
 *  - blockBudget: { min:number, max:number }  // from difficulty config
 *  - reserved?: Set<string>   // keys "r,c" that may NOT be blocked (e.g., theme letters)
 *  - logs?: boolean
 *
 * @returns { grid, placedPairs, targetBlocks }
 */
export function generateInitialLayout({
  size = 12,
  blockBudget = { min: 18, max: 22 },
  reserved = new Set(),
  logs = false,
} = {}) {
  const grid = makeEmptyGrid(size);

  // Target even number of blocks (we add symmetric pairs = +2 each)
  const target =
    clampToEven(avg(blockBudget.min, blockBudget.max)) || blockBudget.min;
  const targetBlocks = clampToEven(
    Math.max(blockBudget.min, Math.min(blockBudget.max, target))
  );

  const placedPairs = [];
  let safety = size * size * 2; // prevent infinite loops

  while (countBlocks(grid) < targetBlocks && safety-- > 0) {
    const choice = pickBestSplitCandidate(grid, reserved);
    if (!choice) {
      // no more legal places to split long runs; stop early
      break;
    }

    const ok = tryPlaceSymmetricBlock(grid, choice.r, choice.c, reserved);
    if (!ok) {
      // mark this position as "tried" to avoid infinite loops
      choice.tried.add(k(choice.r, choice.c));
      continue;
    }

    placedPairs.push({ r: choice.r, c: choice.c });
    if (logs && placedPairs.length % 2 === 0) {
      console.log(`[layout] blocks: ${countBlocks(grid)}/${targetBlocks}`);
    }
  }

  // Final sanity: ensure it's a valid grid (symmetry, no 2-letter, connectivity)
  if (!validateGridBasic(grid)) {
    throw new Error("Generated layout failed basic grid validation.");
  }

  return { grid, placedPairs, targetBlocks };
}

/**
 * Attempt to add ONE symmetric block pair to break the longest available slot.
 * Great for "rescue" mid-solve when repeated dead-ends occur.
 *
 * @returns { ok:boolean, pos?:{r,c}, reason?:string }
 */
export function addRescueBlockPair(grid, { reserved = new Set() } = {}) {
  const choice = pickBestSplitCandidate(grid, reserved);
  if (!choice) return { ok: false, reason: "no_candidate" };

  const ok = tryPlaceSymmetricBlock(grid, choice.r, choice.c, reserved);
  if (!ok) return { ok: false, reason: "invalid_after_place" };

  return { ok: true, pos: { r: choice.r, c: choice.c } };
}

// ---------------- internal helpers ----------------

/** Count current blocks in the grid. */
export function countBlocks(grid) {
  let n = 0;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid.length; c++) {
      if (grid[r][c] === RULES.blockChar) n++;
    }
  }
  return n;
}

/**
 * Pick a deterministic candidate cell (r,c) to place a symmetric block pair that:
 * - splits the **longest** current slot (across/down),
 * - ensures both resulting parts (left/right or up/down) are >= minEntryLen,
 * - avoids reserved cells and their mirror.
 *
 * Returns { r, c, len, dir, tried:Set<string> } or null.
 */
function pickBestSplitCandidate(grid, reserved) {
  const runs = [
    ...getAcrossRuns(grid).map((r) => ({ ...r, dir: "across" })),
    ...getDownRuns(grid).map((r) => ({ ...r, dir: "down" })),
  ];

  // Only consider runs long enough that a single block can split them into two valid entries
  // With minEntryLen = m, valid split exists iff L >= 2*m + 1.
  const minL = 2 * RULES.minEntryLen + 1;
  const candidates = runs
    .filter((r) => r.length >= minL)
    .sort((a, b) => b.length - a.length); // longest first

  const tried = new Set();

  for (const run of candidates) {
    // propose a center-ish index to split
    const idxRange = validSplitIndices(run.length, RULES.minEntryLen);
    // probe preferred index first (center), then expand outward deterministically
    const order = probeOrder(idxRange);

    for (const i of order) {
      const pos =
        run.dir === "across"
          ? { r: run.row, c: run.colStart + i }
          : { r: run.rowStart + i, c: run.col };

      // Skip if reserved (or its mirror) forbids blocking
      const [mr, mc] = mirrorOf(grid, pos.r, pos.c);
      if (reserved.has(k(pos.r, pos.c)) || reserved.has(k(mr, mc))) {
        continue;
      }

      // Avoid placing directly adjacent to an existing block inside the same run
      // (this would create a 1- or 2-letter fragment). We can check locally:
      if (!localSplitOK(run, i, RULES.minEntryLen)) continue;

      return { ...pos, len: run.length, dir: run.dir, tried };
    }
  }

  return null;
}

/** Which indices inside a run of L are valid to place a block so both sides >= m? */
function validSplitIndices(L, m) {
  // we want i in [m, L - m - 1]
  const start = m;
  const end = L - m - 1;
  if (end < start) return [];
  const arr = [];
  for (let i = start; i <= end; i++) arr.push(i);
  return arr;
}

/** Probe center first, then spread left/right (deterministically). */
function probeOrder(indices) {
  if (indices.length === 0) return [];
  const midIdx = Math.floor((indices.length - 1) / 2);
  const order = [indices[midIdx]];
  let left = midIdx - 1;
  let right = midIdx + 1;
  while (left >= 0 || right < indices.length) {
    if (right < indices.length) order.push(indices[right++]);
    if (left >= 0) order.push(indices[left--]);
  }
  return order;
}

/** Quick local check: splits into [i] left and [L-i-1] right, both >= m. */
function localSplitOK(run, i, m) {
  const L = run.length;
  const left = i;
  const right = L - i - 1;
  return left >= m && right >= m;
}

/**
 * Attempt to place a symmetric block pair at (r,c). Validate and revert if illegal.
 * Returns boolean.
 */
function tryPlaceSymmetricBlock(grid, r, c, reserved) {
  const before = countBlocks(grid);

  // placeBlockSym validates no-2-letter & connectivity; if it fails, it reverts internally.
  const ok = placeBlockSym(grid, r, c, { overwrite: false });

  if (!ok) return false;

  // Extra guard: don't exceed some obscene block density (just in case)
  if (countBlocks(grid) < before) return false;

  // Bonus: double-check basic validity (symmetry is enforced by placeBlockSym)
  if (!validateGridBasic(grid)) {
    // revert
    removeBlockSym(grid, r, c);
    return false;
  }

  return true;
}

/** utils */
function avg(a, b) {
  return Math.round((a + b) / 2);
}
function clampToEven(n) {
  const x = Math.max(0, Math.round(n));
  return x % 2 === 0 ? x : x + 1;
}
function k(r, c) {
  return `${r},${c}`;
}
