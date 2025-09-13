// src/solver/heuristics.js
import { RULES } from "../config/rules.js";
import { candidatesForPattern } from "../dictionary/indexes.js";

/**
 * Select the next slot to fill using a theme-first, then MRV strategy.
 * It prioritizes designated theme slots. Once they are all filled, it
 * uses a clustered MRV approach to solve the rest of the puzzle.
 *
 * @param {Map<string,string[]>} domains
 * @param {Map<string,object>} slotsById
 * @param {object} opts
 * - tieBreak: array of keys for tie-breaking
 * - exclude: Set<slotId> of already assigned slots
 * - themeSlotIds: array<string> of slot IDs to prioritize
 * @returns {object|null} slot
 */
export function selectNextSlot(domains, slotsById, opts = {}) {
  const {
    tieBreak = ["crossingsDesc", "lenDesc", "alphaAsc"],
    exclude = new Set(),
    themeSlotIds = [],
  } = opts;

  // --- Theme-First Strategy ---
  // First, check if there's an unassigned theme slot and select it immediately.
  for (const themeId of themeSlotIds) {
    if (!exclude.has(themeId)) {
      return slotsById.get(themeId);
    }
  }

  // --- MRV + Clustered Heuristic (for filler slots) ---
  // If all theme slots are filled, proceed with the original heuristic.
  // This part prioritizes slots connected to already-filled words.
  const frontier = new Set();
  for (const assignedId of exclude) {
    const assignedSlot = slotsById.get(assignedId);
    if (!assignedSlot) continue;
    for (const cross of assignedSlot.crosses) {
      if (!exclude.has(cross.otherId)) {
        frontier.add(cross.otherId);
      }
    }
  }

  let best = null;
  // If the frontier has slots, choose from it; otherwise, choose from all remaining slots.
  const candidates =
    frontier.size > 0
      ? [...frontier]
      : [...domains.keys()].filter((id) => !exclude.has(id));

  for (const id of candidates) {
    const domain = domains.get(id);
    // Skip slots that are already part of the theme or have no candidates
    if (!domain || domain.length === 0 || themeSlotIds.includes(id)) continue;

    const slot = slotsById.get(id);
    const cand = {
      id,
      size: domain.length,
      slot,
      crossings: slot.crosses?.length || 0,
      len: slot.length,
      alphaKey: id,
    };

    if (!best || better(cand, best, tieBreak)) {
      best = cand;
    }
  }

  return best?.slot ?? null;
}

/** Compare two slot candidates under tie-break rules. */
function better(a, b, tieBreak) {
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
    }
  }
  return false;
}

/**
 * Order a slot’s candidates using LCV (Least-Constraining Value) scoring.
 * This function remains the same as it's a candidate-level heuristic, not a slot-selection one.
 */
export function orderCandidatesLCV({
  grid,
  slot,
  candidates,
  slotsById,
  indexes,
  tierBySlot,
  lcvDepth = 1,
  capPerNeighbor = 50,
}) {
  if (!Array.isArray(candidates) || candidates.length <= 1 || lcvDepth === 0) {
    return (candidates || []).slice().sort((a, b) => a.localeCompare(b));
  }

  const scored = candidates.map((w) => {
    const lcv = lcvNeighborOptions({
      grid,
      slot,
      word: w,
      slotsById,
      indexes,
      tierBySlot,
      capPerNeighbor,
    });
    return { w, score: lcv };
  });

  scored.sort((a, b) => b.score - a.score || a.w.localeCompare(b.w));
  return scored.map((x) => x.w);
}

function lcvNeighborOptions({
  grid,
  slot,
  word,
  slotsById,
  indexes,
  tierBySlot,
  capPerNeighbor = 50,
}) {
  let total = 0;
  if (!slot.crosses || slot.crosses.length === 0) return capPerNeighbor;

  for (const cr of slot.crosses) {
    const other = slotsById.get(cr.otherId);
    if (!other) continue;

    // Use 'both' for LCV checks to get a more realistic count of potential conflicts
    const tier = tierBySlot.get(other.id) === "theme" ? "theme" : "both";

    const pattern = buildProjectedNeighborPattern(
      grid,
      other,
      cr.atOther,
      word[cr.atThis]
    );
    const count = candidatesForPattern(indexes, other.length, pattern, {
      tier,
      limit: capPerNeighbor + 1,
    }).length;
    total += Math.min(count, capPerNeighbor);
  }
  return total;
}

function buildProjectedNeighborPattern(
  grid,
  neighborSlot,
  idxInNeighbor,
  letter
) {
  const arr = neighborSlot.cells.map(({ r, c }) => grid[r][c]);
  if (arr[idxInNeighbor] === RULES.unknownChar) {
    arr[idxInNeighbor] = String(letter || "").toUpperCase();
  }
  return arr.join("");
}
