// src/grid/numbering.js
import { RULES } from "../config/rules.js";
import { isBlock, isWhite } from "./gridModel.js";

/**
 * Build Across/Down numbering for the current grid.
 * - Numbers start at 1, scan row-major.
 * - A start cell is white AND (left is block/OOB for Across) or (above is block/OOB for Down).
 *
 * @param {string[][]} grid                 // N x N char grid
 * @param {Map<string,string>} assignments  // optional: slotId -> answer (from solver)
 * @returns {{
 *  across: Array<{ num:number, row:number, col:number, length:number, slotId:string, pattern:string, answer?:string }>,
 *  down:   Array<{ num:number, row:number, col:number, length:number, slotId:string, pattern:string, answer?:string }>,
 *  slotNum: Map<string, number>            // slotId -> clue number
 * }}
 */
export function buildNumbering(grid, assignments = new Map()) {
  const n = grid.length;
  let num = 0;

  const across = [];
  const down = [];
  const slotNum = new Map();

  // Track visited cells for Down so we don't start in the middle of a down run
  const visitedDown = Array.from({ length: n }, () => Array(n).fill(false));

  // Across first (row-major)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!isStartAcross(grid, r, c)) continue;

      num += 1;
      const { length, pattern } = walkAcross(grid, r, c);
      const slotId = `A_${r}_${c}`;
      slotNum.set(slotId, num);

      const entry = {
        num,
        row: r,
        col: c,
        length,
        slotId,
        pattern,
      };
      const ans = assignments.get(slotId);
      if (ans) entry.answer = ans;

      across.push(entry);
    }

    // mark visitedDown row-wise (so we don't double count in Down pass)
    for (let c = 0; c < n; c++) {
      if (!isWhite(grid, r, c)) continue;
      if (r > 0 && isWhite(grid, r - 1, c)) {
        visitedDown[r][c] = true; // inside a down run; not a start
      }
    }
  }

  // Down pass (row-major)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!isStartDown(grid, r, c)) continue;
      if (visitedDown[r][c]) continue; // not a start

      num += 1;
      const { length, pattern } = walkDown(grid, r, c);
      const slotId = `D_${r}_${c}`;
      slotNum.set(slotId, num);

      const entry = {
        num,
        row: r,
        col: c,
        length,
        slotId,
        pattern,
      };
      const ans = assignments.get(slotId);
      if (ans) entry.answer = ans;

      down.push(entry);
    }
  }

  return { across, down, slotNum };
}

// ---------- helpers ----------

function isStartAcross(grid, r, c) {
  const n = grid.length;
  if (!isWhite(grid, r, c)) return false;
  const leftBlocked = c === 0 || isBlock(grid, r, c - 1);
  const rightWhite = c + 1 < n && isWhite(grid, r, c + 1);
  // must begin a run that has at least minEntryLen letters
  return (
    leftBlocked && rightWhite && runLenAcross(grid, r, c) >= RULES.minEntryLen
  );
}

function isStartDown(grid, r, c) {
  const n = grid.length;
  if (!isWhite(grid, r, c)) return false;
  const aboveBlocked = r === 0 || isBlock(grid, r - 1, c);
  const belowWhite = r + 1 < n && isWhite(grid, r + 1, c);
  return (
    aboveBlocked && belowWhite && runLenDown(grid, r, c) >= RULES.minEntryLen
  );
}

function runLenAcross(grid, r, c) {
  const n = grid.length;
  let len = 0;
  let cc = c;
  while (cc < n && isWhite(grid, r, cc)) {
    len++;
    cc++;
  }
  return len;
}

function runLenDown(grid, r, c) {
  const n = grid.length;
  let len = 0;
  let rr = r;
  while (rr < n && isWhite(grid, rr, c)) {
    len++;
    rr++;
  }
  return len;
}

function walkAcross(grid, r, c) {
  const n = grid.length;
  const chars = [];
  let len = 0;
  let cc = c;
  while (cc < n && isWhite(grid, r, cc)) {
    chars.push(grid[r][cc]);
    len++;
    cc++;
  }
  return { length: len, pattern: chars.join("") };
}

function walkDown(grid, r, c) {
  const n = grid.length;
  const chars = [];
  let len = 0;
  let rr = r;
  while (rr < n && isWhite(grid, rr, c)) {
    chars.push(grid[rr][c]);
    len++;
    rr++;
  }
  return { length: len, pattern: chars.join("") };
}
