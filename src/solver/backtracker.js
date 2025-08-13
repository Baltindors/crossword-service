// src/solver/backtracker.js
import { getDifficultyConfig } from "../config/difficulty.js";
import { RULES } from "../config/rules.js";
import { buildSlots } from "../grid/slots.js";
import { initDomains } from "./domains.js";
import { selectNextSlot, orderCandidatesLCV } from "./heuristics.js";
import { tryPlaceAndPropagate, undoPlacement } from "./propagate.js";

/**
 * Solve a given grid layout (blocks already placed) using pools/indexes.
 *
 * @param {object} params
 *  - grid: char[][]
 *  - indexes: from dictionary/indexes.buildTieredIndexes()
 *  - difficulty: 1..7 (maps to search policy via config)
 *  - enforceUniqueAnswers?: boolean (default true)
 *  - usedWords?: Set<string>  // optional seed of pre-placed answers
 *  - logs?: boolean           // basic progress logs
 *
 * @returns {
 *   ok: boolean,
 *   assignments?: Map<slotId,string>,
 *   grid?: char[][],
 *   stats: {
 *     level: number,
 *     steps: number,
 *     backtracks: number,
 *     maxDepth: number,
 *     durationMs: number,
 *     starvedAtInit: string[],
 *     seed?: number
 *   },
 *   reason?: string,
 *   details?: any
 * }
 */
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

  // 1) Build slots from the current layout
  const { slots, byId: slotsById } = buildSlots(grid);
  if (slots.length === 0) {
    return fail(
      "noSlots",
      { note: "Layout contains no fillable slots." },
      t0,
      cfg
    );
  }

  // 2) Initialize domains (medical-first, auto-widen if starved)
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

  // quick unsat check: any empty domain?
  const empties = [];
  for (const [id, d] of domains.entries()) {
    if (d.length === 0) empties.push(id);
  }
  if (empties.length) {
    return fail("unsatisfiable_initial_domains", { empties, starved }, t0, cfg);
  }

  // 3) Iterative DFS with an explicit frame stack
  const assigned = new Set(); // slotIds placed
  const assignments = new Map(); // slotId -> word
  const frames = []; // search stack
  const stats = {
    level: cfg.level,
    steps: 0,
    backtracks: 0,
    maxDepth: 0,
    starvedAtInit: starved,
  };

  // main loop
  while (true) {
    // time/backtrack caps
    if (Date.now() - t0 > cfg.timeoutMs) {
      return fail("timeout", { assignedCount: assigned.size }, t0, cfg, stats);
    }
    if (stats.backtracks > cfg.maxBacktracks) {
      return fail(
        "backtrack_limit",
        { assignedCount: assigned.size },
        t0,
        cfg,
        stats
      );
    }

    // solved?
    if (assigned.size === domains.size) {
      const durationMs = Date.now() - t0;
      return {
        ok: true,
        assignments,
        grid,
        stats: { ...stats, durationMs },
      };
    }

    // detect any unassigned slot with empty domain -> immediate backtrack
    let dead = false;
    for (const [id, d] of domains.entries()) {
      if (!assigned.has(id) && d.length === 0) {
        dead = true;
        break;
      }
    }
    if (dead) {
      if (!(await backtrackOnce())) {
        return fail("dead_end_no_more_choices", null, t0, cfg, stats);
      }
      continue;
    }

    // If no current frame (or last frame exhausted), choose a new MRV slot
    let frame = frames[frames.length - 1];
    if (!frame || frame.exhausted) {
      const nextSlot = selectNextSlot(domains, slotsById, {
        tieBreak: cfg.tieBreak,
        exclude: assigned,
      });
      if (!nextSlot) {
        // no selectable slot found; either solved or stuck
        if (!(await backtrackOnce())) {
          return fail(
            "no_selectable_slot",
            { assignedCount: assigned.size },
            t0,
            cfg,
            stats
          );
        }
        continue;
      }

      // Order candidates with LCV
      const cand = domains.get(nextSlot.id) || [];
      const ordered = orderCandidatesLCV({
        grid,
        slot: nextSlot,
        candidates: cand,
        slotsById,
        indexes,
        tierBySlot,
        weights: cfg.weights,
        lcvDepth: cfg.lcvDepth,
      });

      frame = {
        slotId: nextSlot.id,
        slot: nextSlot,
        ordered,
        idx: -1,
        record: null,
        exhausted: false,
      };
      frames.push(frame);
    }

    // Try next candidate in the current frame
    frame.idx += 1;

    // Exhausted? backtrack
    if (frame.idx >= frame.ordered.length) {
      frame.exhausted = true;
      if (!(await backtrackOnce())) {
        return fail(
          "exhausted_all_candidates",
          { lastSlot: frame.slotId },
          t0,
          cfg,
          stats
        );
      }
      continue;
    }

    // Attempt placement
    const word = frame.ordered[frame.idx];
    stats.steps += 1;

    const attempt = tryPlaceAndPropagate({
      grid,
      slot: frame.slot,
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

    if (!attempt.ok) {
      // try next candidate
      continue;
    }

    // success on this word -> commit to frame and proceed deeper
    frame.record = attempt.record;
    assigned.add(frame.slotId);
    assignments.set(frame.slotId, word);
    stats.maxDepth = Math.max(stats.maxDepth, frames.length);

    if (logs && assigned.size % 10 === 0) {
      // lightweight progress log
      console.log(`[solve] placed ${assigned.size}/${domains.size} …`);
    }
  }

  // ---------- helpers ----------

  async function backtrackOnce() {
    const top = frames.pop();
    if (!top) return false;

    if (top.record) {
      // undo placement
      undoPlacement({
        grid,
        record: top.record,
        domains,
        tierBySlot,
        usedWords,
      });
      assigned.delete(top.slotId);
      assignments.delete(top.slotId);
      stats.backtracks += 1;
    }
    return frames.length >= 0;
  }
}

// ---------- utility: standard failure envelope ----------
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
