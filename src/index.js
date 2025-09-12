// src/index.js
import "dotenv/config";
import fs from "fs/promises";
import OpenAI from "openai";

import { GRID_MAX_LETTERS } from "./utils/constants.js";
import { puzzleConfig } from "./config/puzzleConfig.js";
import { buildCandidatePools } from "./utils/dictionary.js";
import {
  buildSystemPrompt,
  buildThemeWordsPrompt,
} from "./ai/promptTemplates.js";
import { planAndSolve } from "./solver/planner.js";
import { writeCluesFromGrid } from "./clueing/clueWriter.js";
import {
  addWordsToPools,
  loadPoolsSafe,
  savePoolsAtomic,
} from "./utils/poolsStore.js"; // Import pool utilities

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// A structured way to call the OpenAI API and handle JSON parsing
async function callJSONApi(system, user) {
  try {
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user.content },
      ],
      temperature: 0.5,
      response_format: { type: "json_object" },
    });
    return JSON.parse(res.choices[0].message.content ?? "{}");
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
    throw new Error("Failed to get a valid JSON response from the AI.");
  }
}

// Fetches a list of theme-related words from the AI using user guidance
async function getThemeWords({ topic, positivePrompt, negativePrompt }) {
  const system = buildSystemPrompt();
  const user = buildThemeWordsPrompt({
    topic,
    positivePrompt,
    negativePrompt,
    wordCount: 30,
    maxLength: GRID_MAX_LETTERS,
  });
  const json = await callJSONApi(system, user);
  return (json.themeWords || []).map((s) => String(s || "").toUpperCase());
}

// The main orchestration function
async function main() {
  console.log("🚀 Starting AI-driven crossword generation pipeline...");

  try {
    // Clean up previous run's files
    await fs.rm("src/data/grid_final.json", { force: true });
    await fs.rm("src/data/solver_stats.json", { force: true });
    await fs.rm("src/data/clues.json", { force: true });

    // 1. Load configuration
    const { topic, difficulty, positivePrompt, negativePrompt } = puzzleConfig;
    console.log(`🔹 Topic: ${topic} | Difficulty: ${difficulty}`);

    // 2. AI Brainstorming
    console.log("🔹 Step 1: Brainstorming theme words with AI...");
    const themeWords = await getThemeWords({
      topic,
      positivePrompt,
      negativePrompt,
    });
    if (themeWords.length === 0) {
      throw new Error("AI failed to generate any theme words.");
    }
    console.log(`   → Success: Generated ${themeWords.length} theme words.`);
    await fs.writeFile(
      "src/data/ai_theme_words.json",
      JSON.stringify({ themeWords }, null, 2)
    );

    // 3. Add AI-generated words to the main word pool
    console.log("🔹 Step 2: Adding AI words to the dictionary...");
    const pools = await loadPoolsSafe();
    const added = addWordsToPools(pools, themeWords);
    await savePoolsAtomic(pools);
    console.log(
      `   → Success: Added ${
        Object.keys(added).length > 0
          ? Object.values(added).reduce((a, b) => a + b)
          : 0
      } new words.`
    );

    // 4. Build and hydrate the general word pools
    const allLengths = Array.from(
      { length: GRID_MAX_LETTERS - 2 },
      (_, i) => i + 3
    );
    console.log("🔹 Step 3: Building and hydrating word pools...");
    await buildCandidatePools({ topic, lengths: allLengths, perLength: 50 });
    console.log("   → Success: Word pools are ready.");

    // 5. Run the solver
    console.log(
      "🔹 Step 4: Solving the puzzle grid (this may take up to a minute)..."
    );
    const solveResult = await planAndSolve({
      size: 12,
      difficulty,
      logs: true,
      themeWords,
    });

    if (!solveResult.ok) {
      console.error("   → Solver failed. See solver_stats.json for details.");
      throw new Error(`Solver failed: ${solveResult.reason}`);
    }
    console.log("   → Success: Puzzle grid solved!");

    // 6. Generate clues
    console.log("🔹 Step 5: Generating clues for the final grid...");
    await writeCluesFromGrid({ topic, difficulty });
    console.log("   → Success: Clues generated and saved.");

    console.log("\n✅ Crossword generation pipeline completed successfully!");
  } catch (error) {
    console.error("\n🔥 Pipeline failed:", error.message);
    process.exit(1);
  }
}

main();
