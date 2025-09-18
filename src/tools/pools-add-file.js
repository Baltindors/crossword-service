#!/usr/bin/env node
// src/tools/pools-add-file.js
import fs from "fs/promises";
import {
  loadPoolsSafe,
  savePoolsAtomic,
  addWordsToPools,
  POOLS_PATH,
} from "../utils/poolsStore.js";

async function readWordsFromFile(p) {
  const raw = await fs.readFile(p, "utf8");
  // Accept one-per-line and also tolerate commas/semicolons
  return raw
    .split(/[\r\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: node src/tools/pools-add-file.js <file1.txt> [file2.txt ...]\n" +
        "Example: node src/tools/pools-add-file.js src/data/my-word-list.txt"
    );
    process.exit(1);
  }

  const pools = await loadPoolsSafe();
  let total = 0;
  const perLen = {};

  for (const filePath of args) {
    try {
      console.log(`Reading words from ${filePath}...`);
      const words = await readWordsFromFile(filePath);
      const added = addWordsToPools(pools, words);

      const count = Object.values(added).reduce((a, b) => a + b, 0);
      total += count;

      for (const [len, c] of Object.entries(added)) {
        perLen[len] = (perLen[len] || 0) + c;
      }
      console.log(`+ Added ${count} new words from ${filePath}`);
    } catch (error) {
      console.error(`\nError processing file ${filePath}: ${error.message}`);
    }
  }

  await savePoolsAtomic(pools);

  console.log(`\n✅ Updated ${POOLS_PATH}`);
  if (total === 0) {
    console.log(
      "No new words were added (duplicates or invalid words were ignored)."
    );
  } else {
    console.log(`Total new words added: ${total}`);
    for (const len of Object.keys(perLen).sort((a, b) => a - b)) {
      console.log(`  • Length ${len}: +${perLen[len]}`);
    }
  }
}

main().catch((e) => {
  console.error("❌ Failed:", e.message);
  process.exit(1);
});
