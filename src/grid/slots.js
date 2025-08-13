// src/grid/slots.js
import { RULES, isValidToken } from "../config/rules.js";
import { isBlock, isWhite, placeLetter, clearCell } from "./gridModel.js";

/**
 * Slot shape:
 * {
 *   id: "A_r_c" | "D_r_c",
 *   dir: "across"|"down",
 *   row: number,       // start row
 *   col: number,       // start col
 *   length: number,
 *   cells: Array<{ r:number, c:number }>, // in order
 *   crosses: Array<{ otherId:string, atThis:number, atOther:number }>
 * }
 */

/** Build all slots (Across + Down) and compute crossings. */
export function buildSlots(grid) {
  const across = extractAcrossSlots(grid);
  const down = extractDownSlots(grid);

  // occupancy maps for crossing detection
  const occA = new Map(); // key "r,c" -> { id, idx }
  const occD = new Map();

  for (const s of across) {
    s.cells.forEach(({ r, c }, i) => occA.set(key(r, c), { id: s.id, idx: i }));
  }
  for (const s of down) {
    s.cells.forEach(({ r, c }, i) => occD.set(key(r, c), { id: s.id, idx: i }));
  }

  // fill crosses (both directions)
  const byId = new Map();
  for (const s of [...across, ...down]) {
    s.crosses = [];
    byId.set(s.id, s);
  }

  for (const s of across) {
    s.cells.forEach(({ r, c }, i) => {
      const hit = occD.get(key(r, c));
      if (hit) {
        s.crosses.push({ otherId: hit.id, atThis: i, atOther: hit.idx });
        const d = byId.get(hit.id);
        d.crosses.push({ otherId: s.id, atThis: hit.idx, atOther: i });
      }
    });
  }

  return {
    slots: [...across, ...down],
    across,
    down,
    byId,
  };
}

/** Extract Across slots (length >= RULES.minEntryLen). */
export function extractAcrossSlots(grid) {
  const n = grid.length;
  const out = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      const startOK =
        isWhite(grid, r, c) && (c === 0 || isBlock(grid, r, c - 1));
      if (!startOK) {
        c++;
        continue;
      }
      // walk to end of run
      const cells = [];
      let cc = c;
      while (cc < n && isWhite(grid, r, cc)) {
        cells.push({ r, c: cc });
        cc++;
      }
      const len = cells.length;
      if (len >= RULES.minEntryLen) {
        out.push({
          id: `A_${r}_${c}`,
          dir: "across",
          row: r,
          col: c,
          length: len,
          cells,
          crosses: [],
        });
      }
      c = cc + 1; // skip the block we stopped at
    }
  }
  return out;
}

/** Extract Down slots (length >= RULES.minEntryLen). */
export function extractDownSlots(grid) {
  const n = grid.length;
  const out = [];
  for (let c = 0; c < n; c++) {
    let r = 0;
    while (r < n) {
      const startOK =
        isWhite(grid, r, c) && (r === 0 || isBlock(grid, r - 1, c));
      if (!startOK) {
        r++;
        continue;
      }
      // walk to end of run
      const cells = [];
      let rr = r;
      while (rr < n && isWhite(grid, rr, c)) {
        cells.push({ r: rr, c });
        rr++;
      }
      const len = cells.length;
      if (len >= RULES.minEntryLen) {
        out.push({
          id: `D_${r}_${c}`,
          dir: "down",
          row: r,
          col: c,
          length: len,
          cells,
          crosses: [],
        });
      }
      r = rr + 1; // skip the block we stopped at
    }
  }
  return out;
}

/** Build the current pattern string for a slot (letters + unknownChar). */
export function getSlotPattern(grid, slot) {
  const chars = slot.cells.map(({ r, c }) => grid[r][c]);
  return chars.join("");
}

/**
 * Check if a word fits a slot against the grid’s current letters.
 * Does NOT modify the grid.
 */
export function fitsWord(grid, slot, word) {
  const w = String(word || "").toUpperCase();
  if (w.length !== slot.length) return false;
  if (!/^[A-Z0-9_]+$/.test(w)) return false;

  for (let i = 0; i < slot.length; i++) {
    const { r, c } = slot.cells[i];
    const ch = grid[r][c];
    if (ch !== RULES.unknownChar && ch !== w[i]) return false;
  }
  return true;
}

/**
 * Place a word into a slot.
 * Returns { ok, changes } where changes = array of { r,c,prev,now } for backtracking.
 */
export function placeWord(grid, slot, word) {
  const w = String(word || "").toUpperCase();
  if (!fitsWord(grid, slot, w)) return { ok: false, changes: [] };

  const changes = [];
  for (let i = 0; i < slot.length; i++) {
    const { r, c } = slot.cells[i];
    const prev = grid[r][c];
    if (prev === w[i]) continue; // already set
    // placeLetter validates token char and global 2-letter constraints
    const ok = placeLetter(grid, r, c, w[i]);
    if (!ok) {
      // rollback
      for (let j = changes.length - 1; j >= 0; j--) {
        const chg = changes[j];
        clearCell(grid, chg.r, chg.c);
        // restore previous value (unknown or letter)
        if (chg.prev !== RULES.unknownChar)
          placeLetter(grid, chg.r, chg.c, chg.prev);
      }
      return { ok: false, changes: [] };
    }
    changes.push({ r, c, prev, now: w[i] });
  }
  return { ok: true, changes };
}

/** Undo a set of changes returned from placeWord(). */
export function undoChanges(grid, changes) {
  for (let i = changes.length - 1; i >= 0; i--) {
    const { r, c, prev, now } = changes[i];
    clearCell(grid, r, c);
    if (prev !== RULES.unknownChar) placeLetter(grid, r, c, prev);
  }
}

/** Utility: key for cell maps */
function key(r, c) {
  return `${r},${c}`;
}
