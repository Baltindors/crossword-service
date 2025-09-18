// src/config/difficulty.js

const BASE = {
  // The min/max number of black squares. More blocks = easier puzzle.
  blockBudget: { min: 28, max: 32 },

  // When a slot's word list is below this, fetch more from OneLook.
  hydrateIfBelow: 12,

  // How long the solver will run before timing out (in milliseconds).
  timeoutMs: 60000,

  // The maximum number of times the solver can backtrack.
  maxBacktracks: 50000,

  // --- HEURISTICS ---
  // How many steps to "look ahead" when choosing a word. Higher is smarter but slower.
  lcvDepth: 1,

  // The order of tie-breakers when choosing the next slot to fill.
  tieBreak: ["crossingsDesc", "lenDesc", "alphaAsc"],

  // Whether to shuffle candidates before scoring them. Adds variety.
  shuffleCandidates: true,
};

const LEVELS = {
  1: {
    name: "easy",
    blockBudget: { min: 30, max: 34 },
    themeSlots: 2,
  },
  2: {
    name: "easy+",
    blockBudget: { min: 30, max: 34 },
    themeSlots: 2,
  },
  3: {
    name: "medium",
    blockBudget: { min: 58, max: 82 },
  },
  4: {
    name: "medium+",
    blockBudget: { min: 28, max: 32 },
  },
  5: {
    name: "hard",
    blockBudget: { min: 26, max: 30 },
    lcvDepth: 2, // Deeper lookahead for harder puzzles
  },
  6: {
    name: "hard+",
    blockBudget: { min: 26, max: 30 },
    lcvDepth: 2,
  },
  7: {
    name: "expert",
    blockBudget: { min: 24, max: 28 },
    lcvDepth: 2,
  },
};

export function getDifficultyConfig(level = 3) {
  const lvl = LEVELS[level] || LEVELS[3];
  return { ...BASE, ...lvl, level };
}
