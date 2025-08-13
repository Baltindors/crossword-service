// src/solver/propagate.js
import { RULES } from "../config/rules.js";
import { placeWord, undoChanges } from "../grid/slots.js";
import {
  recomputeAfterPlacement,
  snapshotDomains,
  restoreDomainsSnapshot,
  removeWordFromAllDomains,
} from "./domains.js";

/**
 * Try to place `word` into `slot`, then forward-check (recompute domains for crossings).
 * If anything empties, revert and return { ok:false }.
 *
 * @param {object} params
 *  - grid: char[][]
 *  - slot: slot object (from buildSlots)
 *  - word: string (already uppercase ok; will be uppercased)
 *  - domains: Map<slotId, string[]>
 *  - tierBySlot: Map<slotId, "medical"|"both"|"general">
 *  - slotsById: Map<slotId, slot>
 *  - indexes: tiered indexes (from buildTieredIndexes)
 *  - usedWords: Set<string>  // answers placed so far
 *  - policy?: object         // same shape used in domains.js (unlock thresholds)
 *  - enforceUniqueAnswers?: boolean (default true) — remove `word` from all other domains
 *
 * @returns {
 *   ok: boolean,
 *   record?: PlacementRecord,
 *   reason?: string,
 *   details?: any,
 * }
 *
 * PlacementRecord = {
 *   slotId: string,
 *   word: string,
 *   gridChanges: Array<{r,c,prev,now}>,
 *   domainsSnapshot: { d: {[id]:string[]}, t: {[id]:string} },
 *   removedByUniq: string[],
 *   affectedSlots: string[],
 * }
 */
export function tryPlaceAndPropagate({
  grid,
  slot,
  word,
  domains,
  tierBySlot,
  slotsById,
  indexes,
  usedWords = new Set(),
  policy = {},
  enforceUniqueAnswers = true,
}) {
  const W = String(word || "").toUpperCase();

  // Snapshot domains/tiers BEFORE any mutation
  const domainsSnapshot = snapshotDomains(domains, tierBySlot);

  // 1) Place the word into grid cells (validates token chars & no-2-letter invariant)
  const { ok, changes } = placeWord(grid, slot, W);
  if (!ok) {
    return { ok: false, reason: "placeWordFailed" };
  }

  // 2) Update usedWords + (optionally) remove word from all other domains to enforce uniqueness
  usedWords.add(W);
  let removedByUniq = [];
  if (enforceUniqueAnswers) {
    removedByUniq = removeWordFromAllDomains(domains, W);
  }

  // 3) Recompute domains for crossing neighbors (forward-check)
  const { emptied, starved, affected } = recomputeAfterPlacement({
    grid,
    placedSlot: slot,
    slotsById,
    indexes,
    usedWords,
    policy,
    domains,
    tierBySlot,
  });

  if (emptied.length > 0) {
    // revert everything
    undoChanges(grid, changes);
    restoreDomainsSnapshot(domains, tierBySlot, domainsSnapshot);
    usedWords.delete(W);
    return {
      ok: false,
      reason: "forwardCheckEmptied",
      details: { emptied, starved, affected },
    };
  }

  // success
  const record = {
    slotId: slot.id,
    word: W,
    gridChanges: changes,
    domainsSnapshot,
    removedByUniq,
    affectedSlots: affected,
  };

  return { ok: true, record, details: { starved, affected } };
}

/**
 * Undo a placement performed by tryPlaceAndPropagate().
 * Restores grid letters, domains/tiers, and usedWords.
 */
export function undoPlacement({
  grid,
  record,
  domains,
  tierBySlot,
  usedWords = new Set(),
}) {
  if (!record) return;

  // 1) Restore grid cells
  undoChanges(grid, record.gridChanges);

  // 2) Restore domains & tiers
  restoreDomainsSnapshot(domains, tierBySlot, record.domainsSnapshot);

  // 3) Restore usedWords
  usedWords.delete(record.word);
}
