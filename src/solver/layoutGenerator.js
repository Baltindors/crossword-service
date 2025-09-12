// src/solver/layoutGenerator.js
import {
  makeEmptyGrid,
  placeBlockSym,
  validateGridBasic,
  cloneGrid,
} from "../grid/gridModel.js";
import { RULES } from "../config/rules.js";

// A set of high-quality, professionally-used seed patterns for 12x12 grids.
// These provide a much better starting point than an empty grid.
const SEED_PATTERNS = [
  // Pattern 1
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
  ],
  // Pattern 2
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
  ],
  // Pattern 3
  [
    [1, 1],
    [1, 5],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 1],
    [5, 5],
  ],
];

// A simple, seeded random number generator for reproducibility
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
 * Generates an initial grid layout.
 * If a grid with pre-placed theme words is provided, it builds around them.
 * Otherwise, it starts with a professional seed pattern.
 */
export function generateInitialLayout({
  size = 12,
  blockBudget = { min: 28, max: 32 },
  logs = false,
  seed = undefined,
  grid: initialGrid = null, // Optional initial grid with theme words
} = {}) {
  const rand = makeRNG(seed);
  const grid = initialGrid ? cloneGrid(initialGrid) : makeEmptyGrid(size);

  // 1. If no initial grid was provided, start with a random seed pattern
  if (!initialGrid) {
    const seedPattern =
      SEED_PATTERNS[Math.floor(rand() * SEED_PATTERNS.length)];
    for (const [r, c] of seedPattern) {
      placeBlockSym(grid, r, c, { overwrite: true });
    }
  }

  // 2. Determine the target number of blocks for this puzzle
  const targetBlocks = Math.floor(
    rand() * (blockBudget.max - blockBudget.min + 1) + blockBudget.min
  );

  // 3. Add random blocks until the target is reached
  let attempts = 0;
  while (countBlocks(grid) < targetBlocks && attempts < 2000) {
    attempts++;
    const r = Math.floor(rand() * size);
    const c = Math.floor(rand() * size);

    // placeBlockSym now correctly handles not overwriting existing letters
    if (placeBlockSym(grid, r, c, { overwrite: false })) {
      if (logs) {
        console.log(
          `[Layout] Added block pair at (${r},${c}). Total: ${countBlocks(
            grid
          )}`
        );
      }
    }
  }

  // 4. Final validation to ensure the grid is legal
  if (!validateGridBasic(grid)) {
    // In a more advanced implementation, we could retry with a different seed here.
    // For now, we'll proceed, but this check is important.
    console.warn("[Layout] Generated layout failed basic grid validation.");
  }

  return { grid };
}
