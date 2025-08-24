// src/solver/backtracker.js
import { getDifficultyConfig } from "../config/difficulty.js";
import { buildSlots } from "../grid/slots.js";
import { initDomains } from "./domains.js";
import { selectNextSlot, orderCandidatesLCV } from "./heuristics.js";
import { tryPlaceAndPropagate, undoPlacement } from "./propagate.js";
import { OneLookHydrator } from "./hydrator.js";

// small local shuffle (used only if cfg.shuffleCandidates)
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Solve a given grid layout (blocks already placed) using pools/indexes.
 *
 * @param {object} params
 *  - grid: char[][]
 *  - indexes: from dictionary/indexes.buildTieredIndexes()
 *  - difficulty: 1..7 (maps to search policy via config)
 *  - enforceUniqueAnswers?: boolean (default true)
 *  - usedWords?: Set<string>
 *  - logs?: boolean
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

  // Optional debug: initial domain sizes
  if (logs) {
    const summary = [];
    for (const s of slots) {
      const d = domains.get(s.id) || [];
      summary.push({
        id: s.id,
        len: s.length,
        dir: s.dir || (s.orientation ?? "?"),
        domain: d.length,
      });
    }
    summary.sort((a, b) => a.domain - b.domain || b.len - a.len);
    console.log("[solve][init] slots:", summary);
    if (starved?.length)
      console.log("[solve][init] starvedAtInit (tier unlock needed):", starved);
  }

  // quick unsat check
  const empties = [];
  for (const [id, d] of domains.entries()) if (d.length === 0) empties.push(id);
  if (empties.length) {
    return fail("unsatisfiable_initial_domains", { empties, starved }, t0, cfg);
  }

  // 3) Prepare search & helpers
  const assigned = new Set(); // slotIds placed
  const assignments = new Map(); // slotId -> word
  const frames = []; // explicit DFS stack
  const stats = {
    level: cfg.level,
    steps: 0,
    backtracks: 0,
    maxDepth: 0,
    starvedAtInit: starved,
  };

  // OneLook hydrator (caches + nogood patterns)
  const hydrator = new OneLookHydrator({
    onelookMax: cfg.onelookMax,
    hydrateIfBelow: cfg.hydrateIfBelow,
    usedWords,
    logs,
  });

  // ---------- main loop ----------
  while (true) {
    // caps
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
      return { ok: true, assignments, grid, stats: { ...stats, durationMs } };
    }

    // rescue empty domains (try OneLook once with force)
    let dead = false;
    for (const [id, d] of domains.entries()) {
      if (!assigned.has(id) && d.length === 0) {
        const s = slotsById.get(id);
        const rescued = await hydrator.hydrateSlot(domains, grid, s, {
          force: true,
        });
        const now = domains.get(id) || [];
        if (!rescued || now.length === 0) {
          dead = true;
          if (logs) console.log("[solve] dead domain at slot:", id);
          break;
        }
      }
    }
    if (dead) {
      if (!(await backtrackOnce()))
        return fail("dead_end_no_more_choices", null, t0, cfg, stats);
      continue;
    }

    // prepare or advance a frame
    let frame = frames[frames.length - 1];
    if (!frame || frame.exhausted || frame.record) {
      const nextSlot = selectNextSlot(domains, slotsById, {
        tieBreak: cfg.tieBreak,
        exclude: assigned,
      });
      if (!nextSlot) {
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

      // hydrate small domains before ordering candidates
      const curDomain = domains.get(nextSlot.id) || [];
      if (hydrator.shouldHydrate(curDomain.length)) {
        await hydrator.hydrateSlot(domains, grid, nextSlot);
      }

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

      const candidateList = cfg.shuffleCandidates
        ? shuffle([...ordered])
        : ordered;

      if (logs) {
        console.log(
          `[solve][mrv] pick slot=${nextSlot.id} len=${nextSlot.length} domain=${cand.length}`
        );
      }

      frame = {
        slotId: nextSlot.id,
        slot: nextSlot,
        ordered: candidateList,
        idx: -1,
        record: null,
        exhausted: false,
      };
      frames.push(frame);
    }

    // already placed? continue to next frame
    if (frame.record) continue;

    // try next candidate
    frame.idx += 1;

    // exhausted all candidates -> mark nogood pattern & backtrack
    if (frame.idx >= frame.ordered.length) {
      if (!frame.record) hydrator.markNogood(frame.slot, grid);
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

    // attempt placement
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
      if (logs) {
        console.log(
          `[solve][reject] slot=${frame.slotId} word=${word} reason=${
            attempt.reason || "conflict"
          }`
        );
      }
      continue; // try next candidate
    }

    // success -> commit & go deeper
    frame.record = attempt.record;
    assigned.add(frame.slotId);
    assignments.set(frame.slotId, word);
    stats.maxDepth = Math.max(stats.maxDepth, frames.length);

    if (logs && (assigned.size % 10 === 0 || assigned.size === 1)) {
      console.log(
        `[solve] placed ${assigned.size}/${domains.size} (last=${frame.slotId}="${word}")`
      );
    }
  }

  // ---------- helpers ----------
  async function backtrackOnce() {
    const top = frames.pop();
    if (!top) return false;

    if (top.record) {
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

      if (logs) {
        console.log(
          `[solve][backtrack] slot=${top.slotId} tried=${top.idx}/${top.ordered.length}`
        );
      }
    }
    return frames.length > 0;
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
