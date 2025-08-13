// src/solver/domains.js
import { RULES } from "../config/rules.js";
import { getSlotPattern } from "../grid/slots.js";
import { candidatesForPattern } from "../dictionary/indexes.js";

/**
 * Policy shape (from difficulty config):
 * {
 *   startTier: "medical" | "both" | "general"      // default "medical"
 *   unlockGeneralAt: { slotDomainLt: number }      // e.g., 3
 * }
 */

const DEFAULT_POLICY = {
  startTier: "medical",
  unlockGeneralAt: { slotDomainLt: 3 },
};

/**
 * Initialize domains for all slots.
 * - Respects start tier (medical-first by default).
 * - If a domain is "starved", auto-widens to 'both' and, if still starved, to 'general'.
 * - Excludes words already used (Set).
 *
 * @returns {
 *   domains: Map<slotId, string[]>,
 *   tierBySlot: Map<slotId, "medical"|"both"|"general">,
 *   starved: string[]   // slotIds that stayed under threshold even after widening
 * }
 */
export function initDomains({
  grid,
  slots,
  indexes,
  usedWords = new Set(),
  policy = {},
}) {
  const pol = { ...DEFAULT_POLICY, ...policy };
  const domains = new Map();
  const tierBySlot = new Map();
  const starved = [];

  for (const slot of slots) {
    const { list, tier, starvedSlot } = computeInitialDomainForSlot({
      grid,
      slot,
      indexes,
      usedWords,
      pol,
    });
    domains.set(slot.id, list);
    tierBySlot.set(slot.id, tier);
    if (starvedSlot) starved.push(slot.id);
  }

  return { domains, tierBySlot, starved };
}

/**
 * Recompute domains for a set of slots (e.g., after placing a word).
 * - Reuses each slot's current tier from tierBySlot.
 * - If a slot becomes starved, auto-widen per policy.
 * - Returns { emptied: string[], starved: string[] } for quick backtrack checks.
 */
export function recomputeDomainsForSlots({
  grid,
  slotIds,
  slotsById,
  indexes,
  usedWords = new Set(),
  policy = {},
  domains,
  tierBySlot,
}) {
  const pol = { ...DEFAULT_POLICY, ...policy };
  const emptied = [];
  const starved = [];

  for (const id of slotIds) {
    const slot = slotsById.get(id);
    if (!slot) continue;

    // Start from the current tier for this slot
    let tier = tierBySlot.get(id) || pol.startTier;
    let list = computeDomain({ grid, slot, indexes, tier, usedWords });

    // If starved, widen tiers progressively
    const threshold =
      pol?.unlockGeneralAt?.slotDomainLt ??
      DEFAULT_POLICY.unlockGeneralAt.slotDomainLt;
    if (list.length < threshold) {
      const widened = widenTier(tier);
      if (widened !== tier) {
        tier = widened;
        list = computeDomain({ grid, slot, indexes, tier, usedWords });
      }
      // If still starved and not yet at 'general', widen once more to 'general'
      if (list.length < threshold && tier !== "general") {
        tier = "general";
        list = computeDomain({ grid, slot, indexes, tier, usedWords });
      }
      if (list.length < threshold) starved.push(id);
    }

    if (list.length === 0) emptied.push(id);
    domains.set(id, list);
    tierBySlot.set(id, tier);
  }

  return { emptied, starved };
}

/**
 * Compute domain for a single slot using a given tier.
 * Filters out already-used answers and enforces token regex.
 */
export function computeDomain({
  grid,
  slot,
  indexes,
  tier = "medical",
  usedWords = new Set(),
  limit = Infinity,
}) {
  const pattern = getSlotPattern(grid, slot); // e.g., "__A_E__"
  const candidates = candidatesForPattern(indexes, slot.length, pattern, {
    tier,
    limit,
    order: "alpha", // keep deterministic
  });

  // Filter duplicates, used words, and invalid tokens (paranoid guard)
  const out = [];
  const seen = new Set();
  for (const w of candidates) {
    if (usedWords.has(w)) continue;
    if (!RULES.tokenRegex.test(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/**
 * Helper used by initDomains: compute domain starting at policy.startTier,
 * and auto-widen if starved.
 */
function computeInitialDomainForSlot({ grid, slot, indexes, usedWords, pol }) {
  const threshold =
    pol?.unlockGeneralAt?.slotDomainLt ??
    DEFAULT_POLICY.unlockGeneralAt.slotDomainLt;
  let tier = pol.startTier || "medical";
  let list = computeDomain({ grid, slot, indexes, tier, usedWords });

  if (list.length < threshold) {
    // widen to 'both'
    tier = widenTier(tier);
    list = computeDomain({ grid, slot, indexes, tier, usedWords });
  }
  if (list.length < threshold && tier !== "general") {
    tier = "general";
    list = computeDomain({ grid, slot, indexes, tier, usedWords });
  }

  const starvedSlot = list.length < threshold;
  return { list, tier, starvedSlot };
}

/** Tier widening progression */
function widenTier(tier) {
  if (tier === "medical") return "both";
  if (tier === "both") return "general";
  return "general";
}

/**
 * After placing a word into `placedSlot`, recompute domains for its crossing slots.
 * Returns { emptied, starved, affected } where affected is the list of recomputed slot IDs.
 *
 * Usage:
 *  const affected = placedSlot.crosses.map(x => x.otherId);
 *  const { emptied } = recomputeAfterPlacement({ grid, placedSlot, slotsById, ... });
 *  if (emptied.length) -> backtrack
 */
export function recomputeAfterPlacement({
  grid,
  placedSlot,
  slotsById,
  indexes,
  usedWords = new Set(),
  policy = {},
  domains,
  tierBySlot,
}) {
  const affected = (placedSlot.crosses || []).map((cr) => cr.otherId);
  const res = recomputeDomainsForSlots({
    grid,
    slotIds: affected,
    slotsById,
    indexes,
    usedWords,
    policy,
    domains,
    tierBySlot,
  });
  return { ...res, affected };
}

/**
 * Utility to build a domain snapshot (for backtracking).
 * Returns a plain object { [slotId]: string[] } and { [slotId]: tier }.
 */
export function snapshotDomains(domains, tierBySlot) {
  const d = {};
  const t = {};
  for (const [id, arr] of domains.entries()) d[id] = arr.slice();
  for (const [id, tier] of tierBySlot.entries()) t[id] = tier;
  return { d, t };
}

/** Restore domains snapshot (in-place). */
export function restoreDomainsSnapshot(domains, tierBySlot, snapshot) {
  domains.clear();
  tierBySlot.clear();
  for (const id of Object.keys(snapshot.d))
    domains.set(id, snapshot.d[id].slice());
  for (const id of Object.keys(snapshot.t)) tierBySlot.set(id, snapshot.t[id]);
}

/**
 * Optional: prune a specific word from all domains (e.g., once chosen).
 * Returns the list of slots where it was removed.
 */
export function removeWordFromAllDomains(domains, word) {
  const affected = [];
  for (const [id, arr] of domains.entries()) {
    const next = arr.filter((w) => w !== word);
    if (next.length !== arr.length) {
      domains.set(id, next);
      affected.push(id);
    }
  }
  return affected;
}
