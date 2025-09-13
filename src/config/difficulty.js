// src/config/difficulty.js

const BASE = {
  blockBudget: { min: 26, max: 32 },
  allowRescueBlocks: true,
  maxRescuePairs: 2,
  medicalFirst: true,
  unlockGeneralAt: {
    slotDomainLt: 3,
    globalBacktracks: 5000,
  },
  timeoutMs: 60000,
  maxBacktracks: 50000,
  useMRV: true,
  // LCV is critical. Use a depth of at least 1 for all levels.
  lcvDepth: 1,
  tieBreak: ["crossingsDesc", "lenDesc", "alphaAsc"],
  shuffleCandidates: true,
  weights: {
    medicalTier: 2.0,
    poolScore: 1.0,
    frequency: 0.5,
    obscurityPenalty: -0.5,
  },
  onelookMax: 200,
  hydrateIfBelow: 12,
  minMedicalPct: 0.6,
};

const LEVELS = {
  1: {
    name: "easy",
    blockBudget: { min: 30, max: 34 },
    // No lcvDepth override - it will default to 1 from BASE
  },
  2: {
    name: "easy+",
    blockBudget: { min: 30, max: 34 },
  },
  3: {
    name: "medium",
    blockBudget: { min: 28, max: 32 },
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
    allowRescueBlocks: false,
    minMedicalPct: 0.7,
  },
};

export function getDifficultyConfig(level = 3) {
  const lvl = LEVELS[level] || LEVELS[3];
  return { ...BASE, ...lvl, level };
}
