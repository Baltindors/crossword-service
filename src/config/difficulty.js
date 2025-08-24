// src/config/difficulty.js

// Base defaults (applied to every level, then overridden per-level)
const BASE = {
  // Block/layout policy
  blockBudget: { min: 26, max: 32 }, // sensible default for ~12×12
  allowRescueBlocks: true,
  maxRescuePairs: 2,

  // Domain tier policy
  medicalFirst: true,
  unlockGeneralAt: {
    // Keep this constant so behavior is predictable across levels
    slotDomainLt: 3,
    globalBacktracks: 5000,
  },

  // Search limits — keep constant across difficulties for clarity
  timeoutMs: 60000,
  maxBacktracks: 50000,

  // Heuristics
  useMRV: true,
  lcvDepth: 1, // per-level tweaks below
  tieBreak: ["crossingsDesc", "lenDesc", "alphaAsc"],

  // Candidate ordering
  shuffleCandidates: true, // keep consistent; difficulty is not randomness

  // Candidate ordering weights
  weights: {
    medicalTier: 2.0,
    poolScore: 1.0,
    frequency: 0.5,
    obscurityPenalty: -0.5,
  },

  // Hydration knobs — ON for all levels
  onelookMax: 200, // results per OneLook call
  hydrateIfBelow: 12, // hydrate small domains under this size

  // Quality gates
  minMedicalPct: 0.6,
};

// Per-level overrides (1 easiest … 7 hardest)
// Keep differences minimal & intuitive:
// - Easier -> more blocks allowed, shallower lookahead (LCV depth 0/1)
// - Harder -> fewer blocks allowed, deeper lookahead (LCV depth 2)
// Hydration, timeouts, and backtrack caps remain constant.
const LEVELS = {
  1: {
    name: "easy",
    blockBudget: { min: 30, max: 34 },
    lcvDepth: 0,
  },
  2: {
    name: "easy+",
    blockBudget: { min: 30, max: 34 },
    lcvDepth: 0,
  },
  3: {
    name: "medium",
    blockBudget: { min: 28, max: 32 },
    lcvDepth: 1,
  },
  4: {
    name: "medium+",
    blockBudget: { min: 28, max: 32 },
    lcvDepth: 1,
  },
  5: {
    name: "hard",
    blockBudget: { min: 26, max: 30 },
    lcvDepth: 2,
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
    allowRescueBlocks: false, // keep shape stricter at expert
    minMedicalPct: 0.7,
  },
};

// Resolve a level (merge BASE + that level only)
export function getDifficultyConfig(level = 3) {
  const lvl = LEVELS[level] || LEVELS[3];
  return { ...BASE, ...lvl, level };
}
