// src/index.js
import "dotenv/config";
import fs from "fs/promises";
import OpenAI from "openai";

import { puzzleConfig } from "./config/puzzleConfig.js";
import {
  buildAnchors,
  pairAnchorsWithConstraints,
} from "./utils/topicPairing.js";
import {
  buildSystemPrompt,
  buildHiddenWordsPrompt,
  buildLengthMatchPrompt,
} from "./ai/promptTemplates.js";

// --- settings (move to constants.js later if you want) ---
const GRID_MAX_LETTERS = 12; // per-token cap for 12x12
const OK = /^[A-Z0-9_]+$/; // allow letters, digits (e.g., CD4COUNT), underscores

// --- openai client ---
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- helpers ---
const up = (s) => String(s || "").toUpperCase();
const upList = (arr) => (arr ?? []).map(up);

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
    console.error("❌ Model did not return valid JSON. Raw output:\n", text);
    throw new Error("Invalid JSON from model");
  }
}

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

function validateSuggestion(orig, sugg, excludeSet) {
  if (!orig || !sugg) return false;
  if (!OK.test(sugg)) return false;
  if (sugg.length !== orig.length) return false;
  if (excludeSet.has(sugg)) return false;
  if (sugg === orig) return false;
  return true;
}

async function main() {
  console.log("🚀 Anchor pairing pipeline starting…");
  await fs.mkdir("src/data", { recursive: true });

  const { topic, difficulty, theme, topicWords } = puzzleConfig;

  // 1) Theme tokens (AI)
  console.log("🔹 Fetching theme tokens…");
  const hiddenTokens = await getHiddenTokens({ topic, phrase: theme.phrase });
  console.log("   → hiddenTokens:", hiddenTokens);

  // 2) Build anchors: THEME FIRST, then topic words
  const anchors = [
    ...hiddenTokens.map((w) => ({ word: up(w), length: up(w).length })),
    ...topicWords.map((w) => ({ word: up(w), length: up(w).length })),
  ];

  // 3) Seed fixed pairs you already know (TRUVADA–DESCOVY)
  const FIX_A = "TRUVADA";
  const FIX_B = "DESCOVY";
  const fixedPairs = [];
  const wordsUpper = new Set(anchors.map((a) => a.word));
  if (wordsUpper.has(FIX_A) && wordsUpper.has(FIX_B)) {
    fixedPairs.push([FIX_A, FIX_B]);
  }

  // 4) Exclude list = all anchors + all words in fixedPairs
  const excludeSet = new Set([
    ...anchors.map((a) => a.word),
    ...fixedPairs.flat(),
  ]);
  const excludeWords = Array.from(excludeSet);

  // 5) Which anchors still need partners? (skip any that are in a fixed pair)
  const fixedFlat = new Set(fixedPairs.flat());
  const anchorsNeedingPartners = anchors.filter((a) => !fixedFlat.has(a.word));

  // 6) Ask AI for one partner per anchor (no anchor-with-anchor pairs)
  console.log(
    `🔹 Requesting partners for ${anchorsNeedingPartners.length} anchors…`
  );
  const system = buildSystemPrompt();
  const user = buildLengthMatchPrompt({
    topic,
    anchors: anchorsNeedingPartners, // [{word,length}]
    excludeWords,
    fixedPairs,
    maxLettersPerToken: GRID_MAX_LETTERS,
  });

  const { partners = [] } = await callJSON(system, user);
  console.log("   → AI partners count:", partners.length);

  // 7) Validate + merge
  const partnersMap = new Map();
  for (const p of partners) {
    const orig = up(p.original);
    const sugg = up(p.suggestion);
    if (validateSuggestion(orig, sugg, excludeSet)) {
      partnersMap.set(orig, sugg);
      excludeSet.add(sugg); // avoid duplicates across suggestions
    }
  }

  // final pairs: fixed first, then (anchor, partner)
  const pairsFinal = [...fixedPairs];
  for (const a of anchorsNeedingPartners) {
    const partner = partnersMap.get(a.word);
    if (partner) pairsFinal.push([a.word, partner]);
  }

  const finalWordList = Array.from(new Set(pairsFinal.flat()));

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
      hiddenTokens, // theme words (AI), used as anchors first
    },
    topic: { words: upList(topicWords) },
    pairing: {
      mode: "anchor",
      anchors, // theme-first order
      fixedPairs, // seeded known pairs
      aiPartners: partners, // raw AI output for traceability
      final: {
        pairsFinal, // e.g., ["KNOW","XXXX"], ["YOUR","YYYY"], …, ["TRUVADA","DESCOVY"]
        finalWordList, // flattened unique list
      },
    },
  };

  console.log("📄 Final JSON:\n", JSON.stringify(foundation, null, 2));
  await fs.writeFile(
    "src/data/foundation.json",
    JSON.stringify(foundation, null, 2)
  );
  console.log("💾 Wrote src/data/foundation.json");
  console.log("🏁 Done.");
}

main().catch((err) => {
  console.error("🔥 Pipeline failed:", err);
  process.exit(1);
});
