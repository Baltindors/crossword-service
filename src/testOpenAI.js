// Usage:
//   node src/testOpenAI.js hidden
//   node src/testOpenAI.js length
//   node src/testOpenAI.js filler
//   node src/testOpenAI.js validate
//   node src/testOpenAI.js clues

import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import {
  buildSystemPrompt,
  buildHiddenWordsPrompt,
  buildLengthMatchPrompt,
  buildFillerWordsPrompt,
  buildValidationPrompt,
  buildCluePrompt,
} from "./ai/promptTemplates.js";
import { puzzleConfig } from "./config/puzzleConfig.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- helper: send system + user messages and print raw JSON text ----
async function run(systemPrompt, userPrompt) {
  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      userPrompt, // { role: 'user', content: '...' }
    ],
    temperature: 0, // deterministic for testing
  });

  const text = res.choices?.[0]?.message?.content ?? "";
  console.log("\n=== MODEL OUTPUT ===\n");
  console.log(text);
}

// ---- set up inputs from your config ----
const { topic, difficulty, theme, topicWords } = puzzleConfig;

// Unpaired example list: in your real flow you’d compute this locally.
// For testing, toss in a few that you want matched:
const unpairedWords = []; // e.g., ["RETROVIRAL"]

// For filler/validation tests, provide a 12x12 grid.
// '.' = black; letters = fixed; '_' = unknown you want AI to fill.
// Replace this with your working grid when you have one.
const placeholderGrid = Array.from({ length: 12 }, () =>
  Array.from({ length: 12 }, () => ".")
);

// Example Across/Down entries for the clues test.
// Replace with your final enumerated entries once you have them.
const acrossEntries = [
  // { num: 1, row: 0, colStart: 0, answer: "ELISA" },
];
const downEntries = [
  // { num: 2, col: 3, rowStart: 1, answer: "TRUVADA" },
];

// ---- choose which test to run ----
const mode = (process.argv[2] || "").toLowerCase();

async function main() {
  const system = buildSystemPrompt();

  switch (mode) {
    case "hidden": {
      const user = buildHiddenWordsPrompt({
        topic,
        themePhrase: theme.phrase,
        maxHiddenWords: 12,
      });
      await run(system, user);
      break;
    }

    case "length": {
      const user = buildLengthMatchPrompt({
        topic,
        unpairedWords,
      });
      await run(system, user);
      break;
    }

    case "filler": {
      const user = buildFillerWordsPrompt({
        topic,
        grid: placeholderGrid,
      });
      await run(system, user);
      break;
    }

    case "validate": {
      const user = buildValidationPrompt({
        grid: placeholderGrid,
      });
      await run(system, user);
      break;
    }

    case "clues": {
      const user = buildCluePrompt({
        topic,
        difficulty,
        acrossEntries,
        downEntries,
      });
      await run(system, user);
      break;
    }

    default: {
      console.log(
        `Choose a mode: hidden | length | filler | validate | clues\n` +
          `Examples:\n  node src/testOpenAI.js hidden\n  node src/testOpenAI.js length`
      );
    }
  }
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
