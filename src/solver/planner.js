// src/solver/planner.js
import fs from "fs/promises";
import { getDifficultyConfig } from "../config/difficulty.js";
import { buildTieredIndexes } from "../dictionary/indexes.js";
import {
  generateInitialLayout,
  addRescueBlockPair,
} from "./layoutGenerator.js";
import { solveWithBacktracking } from "./backtracker.js";
import { toStrings } from "../grid/gridModel.js";

const DATA_DIR = "src/data";
const POOLS_PATH = `${DATA_DIR}/pools.json`;
const GRID_OUT = `${DATA_DIR}/grid_final.json`;
const STATS_OUT = `${DATA_DIR}/solver_stats.json`;

/**
 * Plan and solve a crossword using pools + difficulty knobs.
 *
 * @param {object} opts
 *  - size?: number (default 12)
 *  - difficulty?: 1..7
 *  - logs?: boolean
 *  - allowRescue?: boolean (override difficulty.allowRescueBlocks)
 * @returns result from solveWithBacktracking (with optional retries)
 */
export async function planAndSolve({
  size = 12,
  difficulty = 5,
  logs = true,
  allowRescue,
} = {}) {
  await fs.mkdir(DATA_DIR, { recursive: true });

  // 1) Load candidate pools (tiered or flat shape)
  const pools = await loadPools(POOLS_PATH);

  // 2) Build indexes (byLen + positional)
  const indexes = buildTieredIndexes(pools);

  // 3) Difficulty knobs
  const cfg = getDifficultyConfig(difficulty);
  const canRescue =
    typeof allowRescue === "boolean" ? allowRescue : cfg.allowRescueBlocks;
  const maxRescues = cfg.maxRescuePairs ?? 0;

  // 4) Generate an initial symmetric layout (no theme placement yet)
  const { grid } = generateInitialLayout({
    size,
    blockBudget: cfg.blockBudget,
    reserved: new Set(), // add "r,c" if you pre-place theme letters later
    logs,
  });

  // 5) Try solve; optionally perform a few rescue attempts
  let result = await solveWithBacktracking({
    grid,
    indexes,
    difficulty,
    enforceUniqueAnswers: true,
    logs,
  });

  if (!result.ok && canRescue && maxRescues > 0) {
    if (logs)
      console.log(
        `[planner] initial attempt failed (${result.reason}). Trying rescue blocks…`
      );
    for (let i = 0; i < maxRescues; i++) {
      const res = addRescueBlockPair(grid, { reserved: new Set() });
      if (!res.ok) {
        if (logs)
          console.log(`[planner] rescue #${i + 1} failed: ${res.reason}`);
        break;
      }
      if (logs)
        console.log(
          `[planner] added rescue pair at r=${res.pos.r}, c=${res.pos.c}`
        );
      result = await solveWithBacktracking({
        grid,
        indexes,
        difficulty,
        enforceUniqueAnswers: true,
        logs,
      });
      if (result.ok) break;
    }
  }

  // 6) Persist artifacts
  await writeArtifacts({ result, grid });

  return result;
}

// ---------------- internal helpers ----------------

async function loadPools(path) {
  try {
    const raw = await fs.readFile(path, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Could not read pools at ${path}. Run your prepare step first. ${err.message}`
    );
  }
}

async function writeArtifacts({ result, grid }) {
  try {
    // grid_final.json
    const gridDoc = {
      ok: result.ok,
      size: grid.length,
      grid: toStrings(grid), // array of N strings for easy viewing
      assignments: result.ok
        ? Array.from(result.assignments.entries()).map(([slotId, word]) => ({
            slotId,
            word,
          }))
        : [],
      reason: result.ok ? undefined : result.reason,
    };
    await fs.writeFile(GRID_OUT, JSON.stringify(gridDoc, null, 2));

    // solver_stats.json
    const statsDoc = {
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      details: result.details || null,
      stats: result.stats || {},
      writtenAt: new Date().toISOString(),
    };
    await fs.writeFile(STATS_OUT, JSON.stringify(statsDoc, null, 2));

    console.log(`🧩 Wrote ${GRID_OUT} and ${STATS_OUT}`);
  } catch (err) {
    console.warn(`Failed writing artifacts: ${err.message}`);
  }
}
