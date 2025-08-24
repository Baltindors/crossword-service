// src/solver/hydrator.js
import { fetchOneLookByPattern } from "./providers/onelook.js";

export class OneLookHydrator {
  constructor({
    onelookMax = 200,
    hydrateIfBelow = 12,
    usedWords = new Set(),
    logs = false,
  } = {}) {
    this.onelookMax = onelookMax;
    this.hydrateIfBelow = hydrateIfBelow;
    this.usedWords = usedWords;
    this.logs = logs;
    this.cache = new Map(); // key: `${len}:${pattern}` -> string[]
    this.nogood = new Set(); // key: `${slotId}:${pattern}`
  }

  patternForSlot(grid, slot) {
    let s = "";
    for (const { r, c } of slot.cells) {
      const ch = grid[r][c];
      s += ch && ch !== "_" ? ch.toUpperCase() : "?";
    }
    return s;
  }

  shouldHydrate(size) {
    return size < this.hydrateIfBelow;
  }

  markNogood(slot, grid) {
    const pat = this.patternForSlot(grid, slot);
    const k = `${slot.id}:${pat}`;
    if (this.logs) console.log(`[solve][nogood-add] ${k}`);
    this.nogood.add(k);
  }

  async hydrateSlot(domains, grid, slot, { force = false } = {}) {
    const pattern = this.patternForSlot(grid, slot);
    const cacheKey = `${slot.length}:${pattern}`;
    const deadKey = `${slot.id}:${pattern}`;
    if (this.nogood.has(deadKey)) return false;

    let words;
    if (!force && this.cache.has(cacheKey)) {
      words = this.cache.get(cacheKey);
    } else {
      if (this.logs) console.log(`[onelook] sp=${pattern} len=${slot.length}`);
      try {
        words = await fetchOneLookByPattern(pattern, { max: this.onelookMax });
      } catch (e) {
        if (this.logs) console.log("[onelook] error:", e.message);
        words = [];
      }
      words = words.filter(
        (w) => w.length === slot.length && !this.usedWords.has(w)
      );
      this.cache.set(cacheKey, words);
    }

    if (!words || words.length === 0) return false;

    const cur = domains.get(slot.id) || [];
    const set = new Set(cur);
    let added = 0;
    for (const w of words)
      if (!set.has(w)) {
        set.add(w);
        added++;
      }
    if (added) domains.set(slot.id, Array.from(set));
    return added > 0;
  }
}
