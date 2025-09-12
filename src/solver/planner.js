// src/solver/planner.js
import fs from "fs/promises";
import { getDifficultyConfig } from "../config/difficulty.js";
import { buildTieredIndexes } from "../dictionary/indexes.js";
import { generateInitialLayout } from "./layoutGenerator.js";
import { solveWithBacktracking } from "./backtracker.js";
import { makeEmptyGrid, toStrings } from "../grid/gridModel.js";

const DATA_DIR = "src/data";
const POOLS_PATH = `${DATA_DIR}/pools.json`;
const GRID_OUT = `${DATA_DIR}/grid_final.json`;
const STATS_OUT = `${DATA_DIR}/solver_stats.json`;

// A helper to place a word in the grid
function placeWord(grid, word, r, c, dir) {
  for (let i = 0; i < word.length; i++) {
    const letter = word[i];
    if (dir === "across") {
      grid[r][c + i] = letter;
    } else {
      grid[r + i][c] = letter;
    }
  }
}

/**
 * An intelligent planner that places theme words first,
 * then generates a layout, and finally solves the puzzle.
 */
export async function planAndSolve({
  size = 12,
  difficulty = 3,
  logs = true,
  themeWords = [], // Expects the AI-generated list
} = {}) {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const pools = JSON.parse(await fs.readFile(POOLS_PATH, "utf8"));
  const indexes = buildTieredIndexes(pools, { logs });
  const cfg = getDifficultyConfig(difficulty);

  // 1. Select and place the best "anchor" words from the AI-generated list
  const grid = makeEmptyGrid(size);
  const anchors = themeWords
    .filter((w) => w.length <= size)
    .sort((a, b) => b.length - a.length);

  // A simple but effective placement strategy for the anchor words
  if (anchors.length > 0) placeWord(grid, anchors[0], 5, 0, "across");
  if (anchors.length > 1) placeWord(grid, anchors[1], 3, 3, "across");
  if (anchors.length > 2) placeWord(grid, anchors[2], 7, 5, "across");

  const usedWords = new Set(anchors.slice(0, 3));

  // 2. Generate a layout *around* the placed theme words
  const { grid: layoutGrid } = generateInitialLayout({
    size,
    blockBudget: cfg.blockBudget,
    logs,
    grid, // Pass the grid with theme words to the layout generator
  });

  // 3. Attempt to solve the puzzle
  const result = await solveWithBacktracking({
    grid: layoutGrid,
    indexes,
    difficulty,
    logs,
    usedWords, // Pass the already used words to the solver
  });

  // 4. Persist the results
  await writeArtifacts({ result, grid: layoutGrid });

  return result;
}

// Helper to write the final grid and stats to disk
async function writeArtifacts({ result, grid }) {
  try {
    const gridDoc = {
      ok: result.ok,
      size: grid.length,
      grid: toStrings(grid),
      assignments: result.ok
        ? Array.from(result.assignments.entries()).map(([slotId, word]) => ({
            slotId,
            word,
          }))
        : [],
      reason: result.ok ? undefined : result.reason,
    };
    await fs.writeFile(GRID_OUT, JSON.stringify(gridDoc, null, 2));

    const statsDoc = {
      ...result,
      writtenAt: new Date().toISOString(),
    };
    await fs.writeFile(STATS_OUT, JSON.stringify(statsDoc, null, 2));

    if (result.ok) {
      console.log(`🧩 Wrote ${GRID_OUT} and ${STATS_OUT}`);
    }
  } catch (err) {
    console.warn(`Failed to write artifacts: ${err.message}`);
  }
}
