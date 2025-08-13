// src/index.js
import "dotenv/config"; // load env FIRST
import fs from "fs/promises";
import OpenAI from "openai";

import { GRID_MAX_LETTERS } from "./utils/constants.js";
import { puzzleConfig } from "./config/puzzleConfig.js";
import { buildCandidatePools } from "./utils/dictionary.js"; // returns Map<length, string[]>
import {
  buildSystemPrompt,
  buildHiddenWordsPrompt,
} from "./ai/promptTemplates.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const up = (s) => String(s || "").toUpperCase();
const upList = (arr) => (arr ?? []).map(up);

// Remove fenced code if model goes rogue
function stripCodeFences(str) {
  return str
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

async function callJSON(system, user) {
  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [{ role: "system", content: system }, user],
    temperature: 0,
  });

  let text = res.choices?.[0]?.message?.content ?? "";
  text = stripCodeFences(text);

  try {
    return JSON.parse(text);
  } catch {
    console.error("Invalid JSON from model:\n", text);
    throw new Error("Invalid JSON");
  }
}

async function getHiddenTokens({ topic, phrase }) {
  const system = buildSystemPrompt();
  const user = buildHiddenWordsPrompt({
    topic,
    themePhrase: phrase,
    maxLettersPerToken: GRID_MAX_LETTERS,
    maxTokens: GRID_MAX_LETTERS,
  });
  const json = await callJSON(system, user);
  return upList(json.hiddenWordsOrdered);
}

async function main() {
  console.log("Candidate-pool pipeline starting…");
  await fs.mkdir("src/data", { recursive: true });

  // Hard reset last run’s artifacts
  await fs.rm("src/data/foundation.json", { force: true }).catch(() => {});
  await fs.rm("src/data/pools.json", { force: true }).catch(() => {});

  const { topic, difficulty, theme, topicWords } = puzzleConfig;

  // 1) Theme tokens (AI)
  console.log("🔹 Fetching theme tokens…");
  const hiddenTokens = await getHiddenTokens({ topic, phrase: theme.phrase });
  console.log("   → hiddenTokens:", hiddenTokens);

  // 2) Build pools for ALL slot lengths we might see in a 12×12: 3..GRID_MAX_LETTERS
  const allLengths = Array.from(
    { length: GRID_MAX_LETTERS - 3 + 1 },
    (_, i) => i + 3
  );
  console.log(
    `🔹 Building candidate pools for lengths: ${allLengths.join(", ")}`
  );

  // 3) Build OneLook candidate pools (up to 30 per length)
  const poolsMap = await buildCandidatePools({
    topic,
    lengths: allLengths,
    perLength: 50, // tweak as needed
  });

  // Ensure determinism: dedupe + sort alpha
  for (const [L, arr] of poolsMap.entries()) {
    poolsMap.set(L, [...new Set(arr.map(up))].sort());
  }

  // 4) Serialize pools to a plain object for saving
  const poolsObj = Object.fromEntries(
    [...poolsMap.entries()]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([L, arr]) => [String(L), arr])
  );

  // 5) Build foundation artifact (solver-friendly, no pre-pairing)
  const foundation = {
    meta: {
      topic,
      difficulty,
      gridMaxLetters: GRID_MAX_LETTERS,
      createdAt: new Date().toISOString(),
    },
    theme: {
      phrase: theme.phrase,
      instructions: theme.instructions,
      hiddenTokens,
    },
    topic: { words: upList(topicWords) },
    candidates: {
      mode: "byLength-onelook",
      lengths: allLengths,
      perLength: 30,
      summary: Object.fromEntries(
        Object.entries(poolsObj).map(([L, arr]) => [L, arr.length])
      ),
    },
  };

  // 6) Save artifacts
  await fs.writeFile(
    "src/data/foundation.json",
    JSON.stringify(foundation, null, 2)
  );
  await fs.writeFile("src/data/pools.json", JSON.stringify(poolsObj, null, 2));

  console.log("📄 foundation.json and pools.json written to src/data/");
  console.log("🏁 Done.");
}

main().catch((err) => {
  console.error("🔥 Pipeline failed:", err);
  process.exit(1);
});
