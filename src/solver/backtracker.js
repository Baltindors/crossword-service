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
}) {
  const cfg = getDifficultyConfig(difficulty);
  const t0 = Date.now();

  // 1. Build the puzzle's slots from the grid layout
  const { slots, byId: slotsById } = buildSlots(grid);
  if (slots.length === 0) {
    return fail(
      "no_slots",
      { note: "The grid has no placeable slots." },
      t0,
      cfg
    );
  }

  // 2. Initialize the domains for each slot
  const { domains, tierBySlot, starved } = initDomains({
    grid,
    slots,
    indexes,
    usedWords,
    policy: {
      startTier: cfg.medicalFirst ? "medical" : "both",
      unlockGeneralAt: cfg.unlockGeneralAt,
    },
  });

  if (logs) {
    console.log(`[Solver] Initialized with ${slots.length} slots.`);
    if (starved.length > 0) {
      console.log(`[Solver] Starved slots at init: ${starved.join(", ")}`);
    }
  }

  // Check for any immediately unsolvable slots
  const empties = [...domains.entries()]
    .filter(([, d]) => d.length === 0)
    .map(([id]) => id);
  if (empties.length > 0) {
    return fail("unsatisfiable_initial_domains", { empties, starved }, t0, cfg);
  }

  // 3. Set up the backtracking search
  const assignments = new Map();
  const hydrator = new OneLookHydrator({
    onelookMax: cfg.onelookMax,
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

  // The recursive core of the solver
  async function solve(depth) {
    stats.maxDepth = Math.max(stats.maxDepth, depth);

    // Check for termination conditions
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

    // If all slots are filled, we're done!
    if (assignments.size === slots.length) {
      return {
        ok: true,
        assignments,
        grid,
        stats: { ...stats, durationMs: Date.now() - t0 },
      };
    }

    // Select the next slot to fill using our heuristics
    const slot = selectNextSlot(domains, slotsById, {
      tieBreak: cfg.tieBreak,
      exclude: new Set(assignments.keys()),
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

    // Hydrate the domain if it's too small
    const currentDomain = domains.get(slot.id) || [];
    if (hydrator.shouldHydrate(currentDomain.length)) {
      await hydrator.hydrateSlot(domains, grid, slot);
    }

    // Order the candidates to try the most promising ones first
    const candidates = orderCandidatesLCV({
      grid,
      slot,
      candidates: domains.get(slot.id) || [],
      slotsById,
      indexes,
      tierBySlot,
      weights: cfg.weights,
      lcvDepth: cfg.lcvDepth,
    });

    if (cfg.shuffleCandidates) {
      shuffle(candidates);
    }

    if (logs) {
      console.log(
        `[Solver] Depth ${depth}: Trying slot ${slot.id} with ${candidates.length} candidates.`
      );
    }

    // Try each candidate in the ordered list
    for (const word of candidates) {
      stats.steps++;
      const attempt = tryPlaceAndPropagate({
        grid,
        slot,
        word,
        domains,
        tierBySlot,
        slotsById,
        indexes,
        usedWords,
        policy: {
          startTier: cfg.medicalFirst ? "medical" : "both",
          unlockGeneralAt: cfg.unlockGeneralAt,
        },
        enforceUniqueAnswers,
      });

      if (attempt.ok) {
        assignments.set(slot.id, word);
        const result = await solve(depth + 1);
        if (result.ok) {
          return result;
        }
        stats.backtracks++;
        undoPlacement({
          grid,
          record: attempt.record,
          domains,
          tierBySlot,
          usedWords,
        });
        assignments.delete(slot.id);
      }
    }

    // If no candidate worked, backtrack
    return fail("dead_end", { lastSlot: slot.id }, t0, cfg, stats);
  }

  return await solve(0);
}
