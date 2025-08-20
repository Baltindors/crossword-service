// src/run-clues.js
import { writeCluesFromGrid } from "./clueing/clueWriter.js";
import { puzzleConfig } from "./config/puzzleConfig.js";

await writeCluesFromGrid({
  topic: puzzleConfig.topic,
  difficulty: puzzleConfig.difficulty,
  gridPath: "src/data/grid_final.json",
  outPath: "src/data/clues.json",
  batchSize: 40,
});
