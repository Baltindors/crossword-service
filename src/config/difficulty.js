// src/config/difficulty.js
// Base defaults (used if a field isn’t specified for a level)
const BASE = {
  // Block/layout policy
  blockBudget: { min: 17, max: 21 }, // 12×12 typical; tweak per level below
  allowRescueBlocks: true, // permit adding symmetric block pairs mid-solve
  maxRescuePairs: 2,

  // Domain tier policy
  medicalFirst: true,
  // when to unlock "general" filler
  unlockGeneralAt: {
    slotDomainLt: 3, // if a slot’s domain < 3
    globalBacktracks: 2000, // or overall backtracks exceed this
  },

  // Search limits
  timeoutMs: 45000, // hard cap per attempt
  maxBacktracks: 35000,

  // Heuristics
  useMRV: true, // Minimum Remaining Values
  lcvDepth: 1, // Least-Constraining Value lookahead depth (0/1/2)
  tieBreak: ["crossingsDesc", "lenDesc", "alphaAsc"],

  // Candidate ordering weights (score -> alpha tiebreak)
  weights: {
    medicalTier: 2.0, // prefer medical terms
    poolScore: 1.0, // provider/frequency score if you have it
    frequency: 0.5, // if you add word freq later
    obscurityPenalty: -0.5, // penalize rare/odd proper nouns
  },

  // Quality gates
  minMedicalPct: 0.6, // target % of medical entries
};

// Per-level overrides (1 easiest … 7 hardest)
const LEVELS = {
  1: {
    name: "easy",
    blockBudget: { min: 20, max: 24 },
    unlockGeneralAt: { slotDomainLt: 5, globalBacktracks: 1000 },
    maxBacktracks: 50000,
    timeoutMs: 60000,
    lcvDepth: 0, // cheaper, faster
  },
  3: {
    name: "medium",
    blockBudget: { min: 18, max: 22 },
    unlockGeneralAt: { slotDomainLt: 3, globalBacktracks: 3000 },
    maxBacktracks: 35000,
    timeoutMs: 50000,
    lcvDepth: 1,
  },
  5: {
    name: "hard",
    blockBudget: { min: 16, max: 20 },
    unlockGeneralAt: { slotDomainLt: 2, globalBacktracks: 6000 },
    maxBacktracks: 25000,
    timeoutMs: 45000,
    lcvDepth: 2,
    allowRescueBlocks: true, // keep shape stricter
    maxRescuePairs: 2,
  },
  7: {
    name: "expert",
    blockBudget: { min: 14, max: 18 },
    unlockGeneralAt: { slotDomainLt: 1, globalBacktracks: 9000 },
    maxBacktracks: 18000,
    timeoutMs: 40000,
    lcvDepth: 2,
    allowRescueBlocks: false,
    minMedicalPct: 0.75,
  },
};

// Resolve a level (merge BASE + nearest level below)
export function getDifficultyConfig(level = 3) {
  // find the highest defined level <= requested
  const keys = Object.keys(LEVELS)
    .map(Number)
    .sort((a, b) => a - b);
  let chosen = {};
  for (const k of keys) {
    if (level >= k) chosen = { ...chosen, ...LEVELS[k] };
  }
  return { ...BASE, ...chosen, level };
}
