// src/clueing/clueWriter.js
import fs from "fs/promises";
import OpenAI from "openai";

import { buildNumbering } from "../grid/numbering.js";
import { fromStrings } from "../grid/gridModel.js";
import { RULES } from "../config/rules.js";
import { buildSystemPrompt, buildCluePrompt } from "../ai/promptTemplates.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// A robust function to call the OpenAI API and get a JSON response
async function callJSONApi(system, user) {
  try {
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user.content },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const text = res.choices?.[0]?.message?.content ?? "{}";
    return JSON.parse(text);
  } catch (error) {
    console.error("Error calling OpenAI API or parsing JSON:", error);
    throw new Error(
      "Failed to get a valid JSON response from the AI for clue generation."
    );
  }
}

/**
 * Read a solved grid, generate clues for all entries, and save them to a file.
 * @returns {Promise<{across: object[], down: object[], writtenPath: string}>}
 */
export async function writeCluesFromGrid({
  topic,
  difficulty = 3,
  gridPath = "src/data/grid_final.json",
  outPath = "src/data/clues.json",
  batchSize = 30, // Max entries to send in a single AI request
}) {
  // 1. Load the solved grid and assignments
  const gridDoc = JSON.parse(await fs.readFile(gridPath, "utf8"));
  const grid = fromStrings(gridDoc.grid);
  const assignments = new Map(
    (gridDoc.assignments || []).map(({ slotId, word }) => [
      slotId,
      word.toUpperCase(),
    ])
  );

  // 2. Build the numbered entries from the grid
  const { across, down } = buildNumbering(grid, assignments);
  const acrossEntries = across.map((e) => ({ num: e.num, answer: e.answer }));
  const downEntries = down.map((e) => ({ num: e.num, answer: e.answer }));

  // 3. Generate clues in batches to avoid overwhelming the API
  const allClues = { across: [], down: [] };
  const batches = [];

  for (let i = 0; i < acrossEntries.length; i += batchSize) {
    batches.push({ across: acrossEntries.slice(i, i + batchSize), down: [] });
  }
  for (let i = 0; i < downEntries.length; i += batchSize) {
    batches.push({ across: [], down: downEntries.slice(i, i + batchSize) });
  }

  for (const batch of batches) {
    if (batch.across.length === 0 && batch.down.length === 0) continue;

    const system = buildSystemPrompt();
    const user = buildCluePrompt({
      topic,
      difficulty,
      acrossEntries: batch.across,
      downEntries: batch.down,
    });

    const response = await callJSONApi(system, user);
    if (response.across) {
      allClues.across.push(...response.across);
    }
    if (response.down) {
      allClues.down.push(...response.down);
    }
  }

  // 4. Sort clues by number to ensure they are in the correct order
  allClues.across.sort((a, b) => a.num - b.num);
  allClues.down.sort((a, b) => a.num - b.num);

  // 5. Persist the final clues document
  const finalClues = {
    topic,
    difficulty,
    ...allClues,
    writtenAt: new Date().toISOString(),
  };
  await fs.writeFile(outPath, JSON.stringify(finalClues, null, 2));

  return { ...allClues, writtenPath: outPath };
}
