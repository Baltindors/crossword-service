// src/solver/heuristics.js
import { RULES } from "../config/rules.js";
import { candidatesForPattern } from "../dictionary/indexes.js";

/**
 * Select the next slot to fill using MRV (Minimum Remaining Values).
 * Tie-breakers (configurable order): crossingsDesc → lenDesc → alphaAsc → rowAscColAsc
 *
 * @param {Map<string,string[]>} domains
 * @param {Map<string,object>} slotsById  // from buildSlots().byId
 * @param {object} opts
 *   - tieBreak: array of keys in order; defaults below
 *   - exclude?: Set<slotId>  // optional: already assigned slots to skip
 * @returns {object|null} slot
 */
export function selectNextSlot(domains, slotsById, opts = {}) {
  const {
    tieBreak = ["crossingsDesc", "lenDesc", "alphaAsc", "rowAscColAsc"],
    exclude = new Set(),
  } = opts;

  let best = null;

  for (const [id, domain] of domains.entries()) {
    if (exclude.has(id)) continue;
    const slot = slotsById.get(id);
    if (!slot) continue;

    const size = domain.length;
    if (size === 0) continue; // unsatisfiable; caller should handle earlier

    const cand = {
      id,
      size,
      slot,
      crossings: slot.crosses?.length || 0,
      len: slot.length,
      alphaKey: id, // stable
      row: slot.row,
      col: slot.col,
    };

    if (!best || better(cand, best, tieBreak)) best = cand;
  }

  return best?.slot ?? null;
}

/** Compare two slot candidates under tie-break rules. Smaller domain wins by default. */
function better(a, b, tieBreak) {
  // primary: domain size (MRV) — smaller is better
  if (a.size !== b.size) return a.size < b.size;

  for (const key of tieBreak) {
    switch (key) {
      case "crossingsDesc":
        if (a.crossings !== b.crossings) return a.crossings > b.crossings;
        break;
      case "lenDesc":
        if (a.len !== b.len) return a.len > b.len;
        break;
      case "alphaAsc":
        if (a.alphaKey !== b.alphaKey) return a.alphaKey < b.alphaKey;
        break;
      case "rowAscColAsc":
        if (a.row !== b.row) return a.row < b.row;
        if (a.col !== b.col) return a.col < b.col;
        break;
      default:
        break;
    }
  }
  return false; // keep existing best
}

/**
 * Order a slot’s candidates using LCV (Least-Constraining Value) scoring.
 * We simulate placing each candidate by "virtually" fixing its letters at crossing positions
 * and counting how many options neighbors would have under their current tier.
 *
 * @param {object} params
 *  - grid: current grid (2D array)
 *  - slot: current slot object
 *  - candidates: string[] (domain for this slot)
 *  - slotsById: Map<slotId, slot>
 *  - indexes: result of buildTieredIndexes()
 *  - tierBySlot: Map<slotId, "medical"|"both"|"general">
 *  - weights?: { medicalTier?: number, poolScore?: number, frequency?: number, obscurityPenalty?: number }
 *  - lcvDepth?: 0|1  // depth 1 = check direct neighbors only (recommended)
 *  - capPerNeighbor?: number // cap neighbor count during scoring to keep it fast (e.g., 50)
 *
 * @returns {string[]} candidates sorted best-first
 */
export function orderCandidatesLCV({
  grid,
  slot,
  candidates,
  slotsById,
  indexes,
  tierBySlot,
  weights = {},
  lcvDepth = 1,
  capPerNeighbor = 50,
}) {
  if (!Array.isArray(candidates) || candidates.length <= 1 || lcvDepth === 0) {
    // Deterministic fallbacks: simple alpha
    return (candidates || []).slice().sort(alpha);
  }

  const scored = [];
  for (const w of candidates) {
    let score = 0;

    // Soft tier bias (if you later tag words by tier/frequency, plug here)
    // For now, neutral base; actual LCV dominates.

    // LCV: sum of neighbor domain sizes if we fix this word’s crossing letters
    const lcv = lcvNeighborOptions({
      grid,
      slot,
      word: w,
      slotsById,
      indexes,
      tierBySlot,
      capPerNeighbor,
    });

    // We want LEAST constraining first → higher neighbor options = better
    score += lcv;

    scored.push({ w, score });
  }

  // Sort by score desc, then alpha for determinism
  scored.sort((a, b) => b.score - a.score || alpha(a.w, b.w));

  return scored.map((x) => x.w);
}

/**
 * Estimate how many options neighbors keep if we place `word` in `slot`.
 * Does not modify the grid; uses positional indexes directly.
 */
function lcvNeighborOptions({
  grid,
  slot,
  word,
  slotsById,
  indexes,
  tierBySlot,
  capPerNeighbor = 50,
}) {
  const w = String(word || "");
  let total = 0;

  if (!slot.crosses || slot.crosses.length === 0) return capPerNeighbor; // no neighbors; neutral

  for (const cr of slot.crosses) {
    const other = slotsById.get(cr.otherId);
    if (!other) continue;

    const tier = tierBySlot.get(other.id) || "medical";

    // Build neighbor pattern as it would look if this word were placed:
    // copy existing pattern, then fix the crossing position to w[cr.atThis]
    const pattern = buildProjectedNeighborPattern(
      grid,
      other,
      cr.atOther,
      w[cr.atThis]
    );

    // Count neighbor candidates under current tier
    const count = candidatesForPattern(indexes, other.length, pattern, {
      tier,
      limit: capPerNeighbor + 1, // +1 so we can clamp without extra calls
      order: "alpha",
    }).length;

    total += Math.min(count, capPerNeighbor);
  }

  return total;
}

/** Build neighbor pattern by "virtually" writing a letter at idx if it’s unknown. */
function buildProjectedNeighborPattern(
  grid,
  neighborSlot,
  idxInNeighbor,
  letter
) {
  const arr = neighborSlot.cells.map(({ r, c }) => grid[r][c]);
  const ch = String(letter || "").toUpperCase();
  if (arr[idxInNeighbor] === RULES.unknownChar) {
    arr[idxInNeighbor] = ch;
  }
  return arr.join("");
}

function alpha(a, b) {
  return String(a).localeCompare(String(b));
}
