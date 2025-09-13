// src/solver/domains.js
import { RULES } from "../config/rules.js";
import { getSlotPattern } from "../grid/slots.js";
import { candidatesForPattern } from "../dictionary/indexes.js";

/**
 * Initialize domains for all slots using a single word pool.
 * - For theme slots, the domain is strictly limited to matching theme words.
 * - For filler slots, it pulls from the unified word index.
 *
 * @returns {
 * domains: Map<string, string[]>,
 * starved: string[] // IDs of filler slots that have few initial candidates
 * }
 */
export function initDomains({
  grid,
  slots,
  indexes,
  usedWords = new Set(),
  themeSlotIds = [],
  themeWords = [],
}) {
  const domains = new Map();
  const starved = [];
  const STARVE_THRESHOLD = 3;

  for (const slot of slots) {
    let list;
    const isThemeSlot = themeSlotIds.includes(slot.id);

    if (isThemeSlot) {
      // Theme slots have a special, restricted domain from the theme list.
      const pattern = getSlotPattern(grid, slot);
      list = themeWords.filter((w) => {
        if (w.length !== slot.length) return false;
        for (let i = 0; i < w.length; i++) {
          if (pattern[i] !== RULES.unknownChar && pattern[i] !== w[i]) {
            return false;
          }
        }
        return !usedWords.has(w);
      });
    } else {
      // Filler slots use the main unified pool.
      list = computeDomain({ grid, slot, indexes, usedWords });
      if (list.length < STARVE_THRESHOLD) {
        starved.push(slot.id);
      }
    }
    domains.set(slot.id, list);
  }

  return { domains, starved };
}

/**
 * Recompute domains for a set of affected slots after a word is placed.
 */
export function recomputeDomainsForSlots({
  grid,
  slotIds,
  slotsById,
  indexes,
  usedWords = new Set(),
  domains,
}) {
  const emptied = [];

  for (const id of slotIds) {
    const slot = slotsById.get(id);
    if (!slot) continue;

    const list = computeDomain({ grid, slot, indexes, usedWords });
    if (list.length === 0) {
      emptied.push(id);
    }
    domains.set(id, list);
  }

  return { emptied };
}

/**
 * Compute the domain for a single slot from the main pool.
 */
export function computeDomain({ grid, slot, indexes, usedWords = new Set() }) {
  const pattern = getSlotPattern(grid, slot);
  // No tiers, so we can call candidatesForPattern directly.
  const candidates = candidatesForPattern(indexes, slot.length, pattern, {
    order: "alpha",
  });

  // Filter out any words that have already been used in the grid
  return candidates.filter((w) => !usedWords.has(w));
}

/**
 * After placing a word into `placedSlot`, recompute domains for its crossing slots.
 */
export function recomputeAfterPlacement({
  grid,
  placedSlot,
  slotsById,
  indexes,
  usedWords = new Set(),
  domains,
}) {
  const affected = (placedSlot.crosses || []).map((cr) => cr.otherId);
  const { emptied } = recomputeDomainsForSlots({
    grid,
    slotIds: affected,
    slotsById,
    indexes,
    usedWords,
    domains,
  });
  return { emptied, affected };
}

/**
 * Utility to build a domain snapshot for backtracking.
 */
export function snapshotDomains(domains) {
  const d = {};
  for (const [id, arr] of domains.entries()) {
    d[id] = [...arr];
  }
  return d;
}

/** Restore a domain snapshot in-place. */
export function restoreDomainsSnapshot(domains, snapshot) {
  domains.clear();
  for (const id in snapshot) {
    domains.set(id, [...snapshot[id]]);
  }
}
