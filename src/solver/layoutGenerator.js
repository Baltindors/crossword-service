// src/solver/layoutGenerator.js
import {
  makeEmptyGrid,
  placeBlockSym,
  validateGridBasic,
  cloneGrid,
} from "../grid/gridModel.js";
import { RULES } from "../config/rules.js";

// A set of high-quality, professionally-used seed patterns for 12x12 grids.
const SEED_PATTERNS = [
  // Pattern 1 (30 blocks)
  [
    [0, 5],
    [1, 1],
    [1, 6],
    [2, 2],
    [2, 7],
    [3, 3],
    [4, 4],
    [5, 0],
    [5, 5],
    [1, 9],
    [3, 7],
    [4, 1],
    [4, 8],
    [5, 3],
    [0, 3],
  ],
  // Pattern 2 (32 blocks)
  [
    [0, 3],
    [1, 4],
    [2, 1],
    [2, 5],
    [3, 0],
    [3, 6],
    [4, 2],
    [4, 7],
    [5, 3],
    [0, 8],
    [1, 6],
    [2, 9],
    [3, 4],
    [4, 8],
    [5, 1],
    [5, 7],
  ],
  // Pattern 3 (28 blocks)
  [
    [1, 1],
    [1, 5],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 1],
    [5, 5],
    [0, 3],
    [0, 8],
    [2, 7],
    [3, 5],
    [4, 1],
    [4, 9],
    [5, 3],
  ],
];

// A simple, seeded random number generator for reproducibility.
function makeRNG(seed) {
  if (typeof seed !== "number") return Math.random;
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Counts the number of blocks in the grid.
function countBlocks(grid) {
  return grid.flat().filter((c) => c === RULES.blockChar).length;
}

/**
 * Generates a valid initial grid layout.
 * It starts with a professional seed pattern and adds random blocks
 * until it meets the budget and passes all structural validation.
 *
 * @param {object} opts
 * - size: number (e.g., 12)
 * - blockBudget: { min: number, max: number }
 * - logs: boolean
 * - seed: number (for reproducibility)
 * @returns {{grid: string[][]}}
 */
export function generateInitialLayout({
  size = 12,
  blockBudget = { min: 28, max: 32 },
  logs = false,
  seed = Date.now(),
} = {}) {
  const rand = makeRNG(seed);
  let grid;
  let attempts = 0;

  // Keep trying until a valid grid is generated or we time out.
  while (attempts < 100) {
    attempts++;
    grid = makeEmptyGrid(size);

    // 1. Start with a random seed pattern.
    const seedPattern =
      SEED_PATTERNS[Math.floor(rand() * SEED_PATTERNS.length)];
    for (const [r, c] of seedPattern) {
      placeBlockSym(grid, r, c, { overwrite: true });
    }

    // 2. Determine a random target number of blocks within the budget.
    const targetBlocks = Math.floor(
      rand() * (blockBudget.max - blockBudget.min + 1) + blockBudget.min
    );

    // 3. Add random symmetric blocks until the target is reached.
    let blockPlacementAttempts = 0;
    while (countBlocks(grid) < targetBlocks && blockPlacementAttempts < 2000) {
      blockPlacementAttempts++;
      const r = Math.floor(rand() * size);
      const c = Math.floor(rand() * size);

      // placeBlockSym returns true if placement was successful and valid.
      placeBlockSym(grid, r, c, { overwrite: false });
    }

    // 4. Final validation to ensure the grid is legal. If so, we're done.
    if (validateGridBasic(grid)) {
      if (logs) {
        console.log(
          `[Layout] Generated a valid layout with ${countBlocks(
            grid
          )} blocks after ${attempts} attempts.`
        );
      }
      return { grid };
    }
  }

  // If we exit the loop, it means we failed to generate a valid grid.
  throw new Error(
    `[Layout] Failed to generate a valid grid layout after ${attempts} attempts.`
  );
}
