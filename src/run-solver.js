// src/run-solver.js
import { planAndSolve } from "./solver/planner.js";
import { puzzleConfig } from "./config/puzzleConfig.js";

const { difficulty } = puzzleConfig;

const res = await planAndSolve({
  size: 12,
  difficulty,
  logs: true, // set false to quiet logs
  // allowRescue: true, // override difficulty if needed
});

console.log(res.ok ? "✅ Solved!" : `❌ Failed: ${res.reason}`);
