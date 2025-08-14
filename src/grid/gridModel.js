// src/grid/gridModel.js
import { RULES, assertGridSize, isValidToken } from "../config/rules.js";

/** Create an N×N grid filled with unknown cells (white). */
export function makeEmptyGrid(n) {
  assertGridSize(n);
  const g = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => RULES.unknownChar)
  );
  return g;
}

/** Deep clone a grid. */
export function cloneGrid(grid) {
  return grid.map((row) => row.slice());
}

/** Convert grid -> array<string> (for saving), and back. */
export function toStrings(grid) {
  return grid.map((row) => row.join(""));
}
export function fromStrings(lines) {
  const n = lines.length;
  assertGridSize(n);
  return lines.map((s) => s.split(""));
}

/** Mirror coordinate for 180° rotational symmetry. */
export function mirrorOf(grid, r, c) {
  const n = grid.length;
  return [n - 1 - r, n - 1 - c];
}

/** In-bounds helper. */
function inBounds(grid, r, c) {
  const n = grid.length;
  return r >= 0 && r < n && c >= 0 && c < n;
}

/** Is this cell a block (black)? */
export function isBlock(grid, r, c) {
  return grid[r][c] === RULES.blockChar;
}

/** Is this cell white (fillable) — unknown or a placed letter/digit/_? */
export function isWhite(grid, r, c) {
  return !isBlock(grid, r, c);
}

function isFixedLetterCell(grid, r, c) {
  const ch = grid[r][c];
  // treat '_' as unknown (not a fixed letter)
  return ch !== RULES.blockChar && ch !== RULES.unknownChar;
}

/** Place a symmetric block at (r,c) and its 180° mirror. Returns false if illegal. */
export function placeBlockSym(grid, r, c, { overwrite = false } = {}) {
  if (!inBounds(grid, r, c)) return false;
  const [mr, mc] = mirrorOf(grid, r, c);

  // Don’t overwrite fixed letters unless explicitly allowed
  if (
    !overwrite &&
    (isFixedLetterCell(grid, r, c) || isFixedLetterCell(grid, mr, mc))
  ) {
    return false;
  }
  const prevA = grid[r][c];
  const prevB = grid[mr][mc];

  grid[r][c] = RULES.blockChar;
  grid[mr][mc] = RULES.blockChar;

  // Validate core constraints immediately
  if (!validateNoTwoLetterSlots(grid)) {
    grid[r][c] = prevA;
    grid[mr][mc] = prevB;
    return false;
  }
  if (RULES.requireConnectivity && !validateConnectivity(grid)) {
    grid[r][c] = prevA;
    grid[mr][mc] = prevB;
    return false;
  }
  return true;
}

/** Remove a symmetric block pair at (r,c) and its mirror -> set to unknownChar. */
export function removeBlockSym(grid, r, c) {
  if (!inBounds(grid, r, c)) return false;
  const [mr, mc] = mirrorOf(grid, r, c);
  grid[r][c] = RULES.unknownChar;
  grid[mr][mc] = RULES.unknownChar;
  return true;
}

/** Place a letter/digit/_ at (r,c). Returns false if invalid. */
export function placeLetter(grid, r, c, ch) {
  if (!inBounds(grid, r, c)) return false;
  if (isBlock(grid, r, c)) return false;

  const up = String(ch || "").toUpperCase();
  // allow underscore as unknown; otherwise must be a valid token char
  const ok = up === RULES.unknownChar || isValidToken(up);
  if (!ok || up.length !== 1) return false;

  const prev = grid[r][c];
  grid[r][c] = up;

  // Optional: live “no 2-letter” guard when letters split slots unexpectedly
  if (!validateNoTwoLetterSlots(grid)) {
    grid[r][c] = prev;
    return false;
  }
  return true;
}

/** Clear a cell back to unknown (white). */
export function clearCell(grid, r, c) {
  if (!inBounds(grid, r, c)) return false;
  if (isBlock(grid, r, c)) return false;
  grid[r][c] = RULES.unknownChar;
  return true;
}

/** Is cell a placed letter/digit/_ (i.e., non-block)? */
function isLetterCell(grid, r, c) {
  const ch = grid[r][c];
  return ch !== RULES.blockChar;
}

/** Validate 180° rotational symmetry of blocks. */
export function isSymmetric(grid) {
  const n = grid.length;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const [mr, mc] = mirrorOf(grid, r, c);
      if (isBlock(grid, r, c) !== isBlock(grid, mr, mc)) return false;
    }
  }
  return true;
}

/** Ensure there are no 1- or 2-letter runs between blocks (across & down). */
export function validateNoTwoLetterSlots(grid) {
  if (!RULES.enforceNoTwoLetter) return true;
  const n = grid.length;

  // Across
  for (let r = 0; r < n; r++) {
    let run = 0;
    for (let c = 0; c < n; c++) {
      if (isBlock(grid, r, c)) {
        if (run > 0 && run < RULES.minEntryLen) return false;
        run = 0;
      } else {
        run++;
      }
    }
    if (run > 0 && run < RULES.minEntryLen) return false;
  }

  // Down
  for (let c = 0; c < n; c++) {
    let run = 0;
    for (let r = 0; r < n; r++) {
      if (isBlock(grid, r, c)) {
        if (run > 0 && run < RULES.minEntryLen) return false;
        run = 0;
      } else {
        run++;
      }
    }
    if (run > 0 && run < RULES.minEntryLen) return false;
  }

  return true;
}

/** Validate connectivity of white cells (single connected component). */
export function validateConnectivity(grid) {
  if (!RULES.requireConnectivity) return true;
  const n = grid.length;

  // find a starting white cell
  let sr = -1,
    sc = -1,
    whiteCount = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (isWhite(grid, r, c)) {
        whiteCount++;
        if (sr === -1) {
          sr = r;
          sc = c;
        }
      }
    }
  }
  if (whiteCount === 0) return true;

  const seen = Array.from({ length: n }, () => Array(n).fill(false));
  const q = [[sr, sc]];
  seen[sr][sc] = true;
  let vis = 1;

  while (q.length) {
    const [r, c] = q.shift();
    const nbrs = [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ];
    for (const [nr, nc] of nbrs) {
      if (!inBounds(grid, nr, nc)) continue;
      if (seen[nr][nc]) continue;
      if (!isWhite(grid, nr, nc)) continue;
      seen[nr][nc] = true;
      vis++;
      q.push([nr, nc]);
    }
  }

  return vis === whiteCount;
}

/** Basic final checks: symmetry, connectivity, no 2-letter slots. */
export function validateGridBasic(grid) {
  if (RULES.symmetry === "rotational-180" && !isSymmetric(grid)) return false;
  if (!validateNoTwoLetterSlots(grid)) return false;
  if (RULES.requireConnectivity && !validateConnectivity(grid)) return false;
  return true;
}

/** Extract across runs: contiguous white cells between blocks (returns positions & strings). */
export function getAcrossRuns(grid) {
  const n = grid.length;
  const runs = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      // start of a run if cell is white and left is block/out-of-bounds
      if (isWhite(grid, r, c) && (c === 0 || isBlock(grid, r, c - 1))) {
        let start = c;
        let s = "";
        while (c < n && isWhite(grid, r, c)) {
          s += grid[r][c];
          c++;
        }
        const len = c - start;
        runs.push({ row: r, colStart: start, length: len, string: s });
      } else {
        c++;
      }
    }
  }
  return runs;
}

/** Extract down runs: contiguous white cells between blocks (returns positions & strings). */
export function getDownRuns(grid) {
  const n = grid.length;
  const runs = [];
  for (let c = 0; c < n; c++) {
    let r = 0;
    while (r < n) {
      if (isWhite(grid, r, c) && (r === 0 || isBlock(grid, r - 1, c))) {
        let start = r;
        let s = "";
        while (r < n && isWhite(grid, r, c)) {
          s += grid[r][c];
          r++;
        }
        const len = r - start;
        runs.push({ col: c, rowStart: start, length: len, string: s });
      } else {
        r++;
      }
    }
  }
  return runs;
}
