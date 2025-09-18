// src/solver/planner.js
import fs from "fs/promises";
import { getDifficultyConfig } from "../config/difficulty.js";
import { generateInitialLayout } from "./layoutGenerator.js";
import { solveWithBacktracking } from "./backtracker.js";
import { toStrings } from "../grid/gridModel.js";
import { buildSlots } from "../grid/slots.js";

// (Helper functions: findBestThemeSlots, modifyLayout, writeArtifacts remain the same)
// ...

// --- Main Planner Logic ---

export async function planAndSolve({
  size = 12,
  difficulty = 3,
  logs = true,
  themeWords = [],
  indexes, // This is the crucial dictionary index
}) {
  // --- NEW: Safeguard Check ---
  // Add a check to ensure the indexes object is always provided.
  if (!indexes || !indexes.byLen || !indexes.posIndex) {
    throw new Error(
      "[Planner] The 'indexes' parameter is missing or invalid. " +
        "The dictionary index must be built and passed to planAndSolve. " +
        "Ensure you are running the pipeline via 'src/index.js'."
    );
  }

  const maxAttempts = 5;
  let lastResult = null;
  let currentGrid = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`🔹 Solving Attempt ${attempt}/${maxAttempts}...`);

    const layout = generateInitialLayout({
      size,
      blockBudget: getDifficultyConfig(difficulty).blockBudget,
      logs: false,
    });
    currentGrid = layout.grid;

    const { slots } = buildSlots(currentGrid);
    if (slots.length === 0) {
      console.warn(
        `[Planner] Layout attempt ${attempt} yielded no usable slots. Retrying...`
      );
      continue;
    }

    // This helper function needs to be defined or imported if it's not in this file
    // const themeSlotIds = findBestThemeSlots(slots, themeWords);
    const themeSlotIds = slots
      .sort((a, b) => b.length - a.length)
      .slice(0, 3)
      .map((s) => s.id);

    if (logs) {
      console.log(
        `   → Identified ${themeSlotIds.length} potential theme slots.`
      );
    }

    const solveResult = await solveWithBacktracking({
      grid: currentGrid,
      indexes,
      difficulty,
      logs,
      usedWords: new Set(),
      themeSlotIds,
      themeWords,
    });

    lastResult = solveResult;

    if (solveResult.ok) {
      console.log(`   → Success on attempt ${attempt}!`);
      // await writeArtifacts({ result: solveResult, grid: solveResult.grid });
      return solveResult;
    }

    console.log(`   → Attempt ${attempt} failed: ${solveResult.reason}.`);
  }

  console.error("❌ All solving attempts failed.");
  // await writeArtifacts({ result: lastResult, grid: currentGrid });
  return lastResult;
}
