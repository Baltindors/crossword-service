// src/solver/hydrator.js
import { fetchOneLookByPattern } from "./onelook.js";
import {
  addWordsToPools,
  savePoolsAtomic,
  loadPoolsSafe,
} from "../utils/poolsStore.js";

export class OneLookHydrator {
  constructor({
    hydrateIfBelow = 5, // Threshold to trigger API call
    usedWords = new Set(),
    logs = false,
  } = {}) {
    this.hydrateIfBelow = hydrateIfBelow;
    this.usedWords = usedWords;
    this.logs = logs;
    this.cache = new Map(); // Cache for the current run: pattern -> words[]
  }

  /**
   * Creates the pattern string (e.g., "A?P??") from a slot's current state in the grid.
   * @param {string[][]} grid The current grid.
   * @param {object} slot The slot object.
   * @returns {string} The pattern string for the API call.
   */
  patternForSlot(grid, slot) {
    let s = "";
    for (const { r, c } of slot.cells) {
      const char = grid[r][c];
      s += char && char !== "_" ? char.toUpperCase() : "?";
    }
    return s;
  }

  /**
   * Checks if a domain is small enough to require fetching more words.
   * @param {number} domainSize The number of words currently available for a slot.
   * @returns {boolean}
   */
  shouldHydrate(domainSize) {
    return domainSize < this.hydrateIfBelow;
  }

  /**
   * Fetches words from OneLook, adds them to the main pools.json,
   * and updates the current in-memory domain for a slot.
   * @param {Map<string, string[]>} domains The solver's current domains map.
   * @param {string[][]} grid The current grid state.
   * @param {object} slot The slot that needs more words.
   * @returns {Promise<boolean>} True if new words were successfully added.
   */
  async hydrateSlot(domains, grid, slot) {
    const pattern = this.patternForSlot(grid, slot);
    const cacheKey = `${slot.length}:${pattern}`;

    if (this.cache.has(cacheKey)) {
      return false; // Already tried to hydrate this exact pattern in this run
    }

    if (this.logs)
      console.log(
        `[Hydrator] Domain for ${slot.id} is small. Fetching pattern: ${pattern}`
      );

    try {
      // 1. Fetch new words from the API
      const newWords = await fetchOneLookByPattern(pattern, { max: 200 });
      this.cache.set(cacheKey, newWords); // Cache the result for this run

      if (newWords.length === 0) {
        if (this.logs)
          console.log(`[Hydrator] OneLook found no new words for ${pattern}.`);
        return false;
      }

      // 2. Add new words to the persistent pools.json file
      const pools = await loadPoolsSafe();
      addWordsToPools(pools, newWords); // This function now handles a flat structure
      await savePoolsAtomic(pools);
      if (this.logs)
        console.log(
          `[Hydrator] Added ${newWords.length} new words to pools.json.`
        );

      // 3. Update the current solver's domain with the new words
      const currentDomain = new Set(domains.get(slot.id) || []);
      let addedCount = 0;
      for (const word of newWords) {
        if (!this.usedWords.has(word) && !currentDomain.has(word)) {
          currentDomain.add(word);
          addedCount++;
        }
      }

      if (addedCount > 0) {
        domains.set(slot.id, Array.from(currentDomain).sort());
        return true;
      }
    } catch (e) {
      console.error(
        `[Hydrator] Error fetching or processing words for ${pattern}:`,
        e.message
      );
    }

    return false;
  }
}
