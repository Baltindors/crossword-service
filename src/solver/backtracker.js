// src/solver/backtracker.js
import { getDifficultyConfig } from "../config/difficulty.js";
import { buildSlots } from "../grid/slots.js";
import { initDomains } from "./domains.js";
import { selectNextSlot, orderCandidatesLCV } from "./heuristics.js";
import { tryPlaceAndPropagate, undoPlacement } from "./propagate.js";
import { OneLookHydrator } from "./hydrator.js";

// Utility to shuffle an array in place
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A more structured and readable failure message creator
function fail(reason, details, t0, cfg, stats = {}) {
  const durationMs = Date.now() - t0;
  return {
    ok: false,
    reason,
    details,
    stats: {
      level: cfg.level,
      steps: stats.steps || 0,
      backtracks: stats.backtracks || 0,
      maxDepth: stats.maxDepth || 0,
      durationMs,
      starvedAtInit: stats.starvedAtInit || [],
    },
  };
}

export async function solveWithBacktracking({
  grid,
  indexes,
  difficulty = 3,
  enforceUniqueAnswers = true,
  usedWords = new Set(),
  logs = false,
  themeSlotIds = [],
  themeWords = [],
}) {
  const cfg = getDifficultyConfig(difficulty);
  const t0 = Date.now();

  const { slots, byId: slotsById } = buildSlots(grid);
  if (slots.length === 0) {
    return fail(
      "no_slots",
      { note: "The grid has no placeable slots." },
      t0,
      cfg
    );
  }

  // Initialize domains with a flat, non-tiered structure
  const { domains, starved } = initDomains({
    grid,
    slots,
    indexes,
    usedWords,
    themeSlotIds,
    themeWords,
  });

  if (logs) {
    console.log(
      `[Solver] Initialized with ${slots.length} slots. Prioritizing ${themeSlotIds.length} theme slots.`
    );
    if (starved.length > 0) {
      console.log(
        `[Solver] Starved filler slots at init: ${starved.join(", ")}`
      );
    }
  }

  const empties = [...domains.entries()]
    .filter(([, d]) => d.length === 0)
    .map(([id]) => id);
  if (empties.length > 0) {
    // Before failing, try one initial hydration pass for empty slots.
    const hydrator = new OneLookHydrator({
      hydrateIfBelow: 1,
      usedWords,
      logs,
    });
    for (const slotId of empties) {
      await hydrator.hydrateSlot(domains, grid, slotsById.get(slotId));
    }
    // Re-check for empties
    const stillEmpty = [...domains.entries()]
      .filter(([, d]) => d.length === 0)
      .map(([id]) => id);
    if (stillEmpty.length > 0) {
      return fail(
        "unsatisfiable_initial_domains",
        { empties: stillEmpty, starved },
        t0,
        cfg
      );
    }
  }

  const assignments = new Map();
  // The hydrator is now a core part of the solver's toolkit.
  const hydrator = new OneLookHydrator({
    hydrateIfBelow: cfg.hydrateIfBelow,
    usedWords,
    logs,
  });

  const stats = {
    level: cfg.level,
    steps: 0,
    backtracks: 0,
    maxDepth: 0,
    starvedAtInit: starved,
  };

  async function solve(depth) {
    stats.maxDepth = Math.max(stats.maxDepth, depth);

    if (Date.now() - t0 > cfg.timeoutMs)
      return fail(
        "timeout",
        { assignedCount: assignments.size },
        t0,
        cfg,
        stats
      );
    if (stats.backtracks > cfg.maxBacktracks)
      return fail(
        "backtrack_limit",
        { assignedCount: assignments.size },
        t0,
        cfg,
        stats
      );
    if (assignments.size === slots.length) {
      return {
        ok: true,
        assignments,
        grid,
        stats: { ...stats, durationMs: Date.now() - t0 },
      };
    }

    const slot = selectNextSlot(domains, slotsById, {
      tieBreak: cfg.tieBreak,
      exclude: new Set(assignments.keys()),
      themeSlotIds,
    });

    if (!slot) {
      return fail(
        "no_selectable_slot",
        { assignedCount: assignments.size },
        t0,
        cfg,
        stats
      );
    }

    // --- DYNAMIC HYDRATION LOGIC ---
    const currentDomain = domains.get(slot.id) || [];
    if (hydrator.shouldHydrate(currentDomain.length)) {
      await hydrator.hydrateSlot(domains, grid, slot);
    }

    const candidates = orderCandidatesLCV({
      grid,
      slot,
      candidates: domains.get(slot.id) || [], // Re-get in case it was hydrated
      slotsById,
      indexes,
    });

    if (cfg.shuffleCandidates) {
      shuffle(candidates);
    }

    for (const word of candidates) {
      stats.steps++;
      // Propagation and domain logic are now simpler without tiers
      const attempt = tryPlaceAndPropagate({
        grid,
        slot,
        word,
        domains,
        slotsById,
        indexes,
        usedWords,
        enforceUniqueAnswers,
      });

      if (attempt.ok) {
        assignments.set(slot.id, word);
        const result = await solve(depth + 1);
        if (result.ok) {
          return result;
        }
        stats.backtracks++;
        undoPlacement({ grid, record: attempt.record, domains, usedWords });
        assignments.delete(slot.id);
      }
    }

    return { ok: false };
  }

  const finalResult = await solve(0);
  finalResult.stats = { ...stats, durationMs: Date.now() - t0 };
  if (!finalResult.ok) {
    finalResult.reason = "dead_end";
    finalResult.details = {
      note: `Solver backtracked from all options after filling ${assignments.size} words.`,
    };
  }

  return finalResult;
}
