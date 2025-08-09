// src/index.js
import dotenv from "dotenv";
dotenv.config();

import fs from "fs/promises";
import OpenAI from "openai";

import { puzzleConfig } from "./config/puzzleConfig.js";
import { analyzeTopicWords } from "./utils/topicPairing.js";
import {
  buildSystemPrompt,
  buildHiddenWordsPrompt,
  buildLengthMatchPrompt,
} from "./ai/promptTemplates.js";

// Single-source settings (should move to ./config/constants.js)
const GRID_MAX_LETTERS = 12; // per-token cap for grid (fits 12x12)
const TARGET_TOTAL_WORDS = 10; // target inventory before filler (5 pairs)

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function callJSON(system, user) {
  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [{ role: "system", content: system }, user],
    temperature: 0,
  });
  const text = res.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(text);
  } catch {
    console.error("Model did not return valid JSON:\n", text);
    throw new Error("Invalid JSON from model");
  }
}

const up = (s) => String(s || "").toUpperCase();
const upList = (arr) => (arr ?? []).map(up);

async function getHiddenTokens({ topic, phrase }) {
  const system = buildSystemPrompt();
  const user = buildHiddenWordsPrompt({
    topic,
    themePhrase: phrase,
    maxLettersPerToken: GRID_MAX_LETTERS,
    maxTokens: 12,
  });
  const json = await callJSON(system, user);
  return upList(json.hiddenWordsOrdered);
}

function pairInitialInventory({ topicWords, hiddenTokens }) {
  // Theme words must be at the top; they’ll be prioritized later for placement too.
  const inputOrder = [...upList(hiddenTokens), ...upList(topicWords)];
  const pairing = analyzeTopicWords(inputOrder, TARGET_TOTAL_WORDS);

  return {
    inputOrder, // theme first, then topic words
    pairsInitial: pairing.pairs,
    unpairedInitial: pairing.unpaired,
    countsInitial: pairing.counts,
    errorsInitial: pairing.errors,
  };
}

async function getLengthMatches({
  topic,
  unpairedWords,
  excludeWords,
  remainingToTarget,
}) {
  // After AI pairs all anchors (unpairedWords), how many are we still short of target?
  const remainingAfterPairing = Math.max(
    0,
    remainingToTarget - unpairedWords.length
  );
  // Each new pair adds 2 words
  const needAdditionalPairs = Math.ceil(remainingAfterPairing / 2);

  const system = buildSystemPrompt();
  const user = buildLengthMatchPrompt({
    topic,
    unpairedWords,
    excludeWords,
    needAdditionalPairs,
    maxLettersPerToken: GRID_MAX_LETTERS,
  });

  const json = await callJSON(system, user);
  return {
    matches: json.matches ?? [],
    newPairs: json.newPairs ?? [],
    needAdditionalPairs,
  };
}

function mergePairs({ pairsInitial, unpairedInitial, lengthMatchResult }) {
  const pairs = [...pairsInitial];

  // Map originals -> suggestions for anchors
  const matchMap = new Map();
  for (const m of lengthMatchResult.matches) {
    const orig = up(m.original);
    const sugg = up(m.suggestion);
    if (orig && sugg) matchMap.set(orig, sugg);
  }

  // Add one partner per unpaired anchor (if provided)
  for (const anchor of unpairedInitial) {
    const partner = matchMap.get(up(anchor));
    if (partner) pairs.push([up(anchor), partner]);
  }

  // Add brand-new pairs
  for (const p of lengthMatchResult.newPairs) {
    const w1 = up(p.word1);
    const w2 = up(p.word2);
    if (w1 && w2) pairs.push([w1, w2]);
  }

  // Final flat list (unique)
  const finalWords = new Set();
  for (const [a, b] of pairs) {
    if (a) finalWords.add(a);
    if (b) finalWords.add(b);
  }

  return { pairsFinal: pairs, finalWordList: Array.from(finalWords) };
}

async function main() {
  const { topic, difficulty, theme, topicWords } = puzzleConfig;

  await fs.mkdir("src/data", { recursive: true });

  // 1) Theme words from AI
  const hiddenTokens = await getHiddenTokens({ topic, phrase: theme.phrase });
  await fs.writeFile(
    "src/data/hiddenTokens.json",
    JSON.stringify({ hiddenTokens }, null, 2)
  );

  // 2) Local pairing on theme-first + topic words
  const prepared = pairInitialInventory({ topicWords, hiddenTokens });
  await fs.writeFile(
    "src/data/localPairing.json",
    JSON.stringify(prepared, null, 2)
  );

  // 3) Build excludes (everything we already have), then ask AI for matches
  const excludeWords = Array.from(new Set(prepared.inputOrder)); // theme + topic
  const lengthMatch = await getLengthMatches({
    topic,
    unpairedWords: prepared.unpairedInitial,
    excludeWords,
    remainingToTarget: prepared.countsInitial.missingToTarget,
  });
  await fs.writeFile(
    "src/data/lengthMatch.response.json",
    JSON.stringify(lengthMatch, null, 2)
  );

  // 4) Merge into final pairs and word list
  const merged = mergePairs({
    pairsInitial: prepared.pairsInitial,
    unpairedInitial: prepared.unpairedInitial,
    lengthMatchResult: lengthMatch,
  });

  const foundation = {
    meta: {
      topic,
      difficulty,
      gridMaxLetters: GRID_MAX_LETTERS,
      targetTotalWords: TARGET_TOTAL_WORDS,
      createdAt: new Date().toISOString(),
    },
    theme: {
      phrase: theme.phrase,
      instructions: theme.instructions,
      hiddenTokens, // <- AI theme words, preserved
    },
    topic: {
      words: upList(topicWords),
    },
    pairing: {
      inputOrder: prepared.inputOrder, // theme first
      local: {
        pairs: prepared.pairsInitial,
        unpaired: prepared.unpairedInitial,
        counts: prepared.countsInitial,
        errors: prepared.errorsInitial,
      },
      ai: lengthMatch, // raw AI output for traceability
      final: merged, // merged pairs + final word list
    },
  };

  // This file is CREATED at runtime (no need to pre-create it)
  await fs.writeFile(
    "src/data/foundation.json",
    JSON.stringify(foundation, null, 2)
  );
  console.log("Wrote src/data/foundation.json");
}

// allow `node src/index.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
