// src/solver/propagate.js
import { placeWord, undoChanges } from "../grid/slots.js";
import {
  recomputeAfterPlacement,
  snapshotDomains,
  restoreDomainsSnapshot,
  removeWordFromAllDomains,
} from "./domains.js";

/**
 * Try to place `word` into `slot`, then forward-check (recompute domains for crossings).
 * If any crossing slot's domain becomes empty, revert and return { ok:false }.
 *
 * @returns {
 * ok: boolean,
 * record?: PlacementRecord, // A record used for undoing the placement
 * reason?: string,
 * }
 */
export function tryPlaceAndPropagate({
  grid,
  slot,
  word,
  domains,
  slotsById,
  indexes,
  usedWords = new Set(),
  enforceUniqueAnswers = true,
}) {
  const W = String(word || "").toUpperCase();

  // Snapshot domains BEFORE any mutation.
  const domainsSnapshot = snapshotDomains(domains);

  // 1) Place the word into grid cells.
  const { ok, changes } = placeWord(grid, slot, W);
  if (!ok) {
    return { ok: false, reason: "placeWordFailed" };
  }

  // 2) Update usedWords and enforce uniqueness if required.
  usedWords.add(W);
  if (enforceUniqueAnswers) {
    removeWordFromAllDomains(domains, W);
  }

  // 3) Recompute domains for crossing neighbors (forward-check).
  const { emptied, affected } = recomputeAfterPlacement({
    grid,
    placedSlot: slot,
    slotsById,
    indexes,
    usedWords,
    domains,
  });

  if (emptied.length > 0) {
    // A crossing slot's domain was wiped out. This is a dead end.
    // Revert everything and report failure.
    undoChanges(grid, changes);
    restoreDomainsSnapshot(domains, domainsSnapshot);
    usedWords.delete(W);
    return {
      ok: false,
      reason: "forwardCheckEmptied",
      details: { emptied },
    };
  }

  // Success! Return a record of the changes so we can undo them later if needed.
  const record = {
    slotId: slot.id,
    word: W,
    gridChanges: changes,
    domainsSnapshot,
    affectedSlots: affected,
  };

  return { ok: true, record };
}

/**
 * Undo a placement performed by tryPlaceAndPropagate().
 * Restores grid letters, domains, and the usedWords set.
 */
export function undoPlacement({
  grid,
  record,
  domains,
  usedWords = new Set(),
}) {
  if (!record) return;

  // 1) Restore grid cells to their previous state.
  undoChanges(grid, record.gridChanges);

  // 2) Restore the domains from the snapshot.
  restoreDomainsSnapshot(domains, record.domainsSnapshot);

  // 3) Remove the word from the set of used words.
  usedWords.delete(record.word);
}
