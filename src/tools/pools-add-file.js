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
  // accept one-per-line; also tolerate commas/semicolons
  return raw
    .split(/[\r\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: node src/tools/pools-add-file.js <file1.txt> [file2.txt ...]"
    );
    process.exit(1);
  }

  const pools = await loadPoolsSafe();

  let total = 0;
  const perLen = {};

  for (const filePath of args) {
    const words = await readWordsFromFile(filePath);
    const added = addWordsToPools(pools, words);
    const count = Object.values(added).reduce((a, b) => a + b, 0);
    total += count;
    for (const [len, c] of Object.entries(added)) {
      perLen[len] = (perLen[len] || 0) + c;
    }
    console.log(`+ ${count} from ${filePath}`);
  }

  await savePoolsAtomic(pools);

  console.log(`✅ Updated ${POOLS_PATH}`);
  if (total === 0) {
    console.log(
      "No new words added (duplicates/invalid lengths were ignored)."
    );
  } else {
    for (const len of Object.keys(perLen).sort((a, b) => a - b)) {
      console.log(`  • length ${len}: +${perLen[len]}`);
    }
  }
}

main().catch((e) => {
  console.error("❌ Failed:", e.message);
  process.exit(1);
});
