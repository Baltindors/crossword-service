// src/index.js
import "dotenv/config";
import fs from "fs/promises";
import OpenAI from "openai";
import { puzzleConfig } from "./config/puzzleConfig.js";
import { getMedicalWordsSameLength } from "./utils/dictionary.js";
import {
  buildAnchors,
  pairAnchorsWithConstraints,
} from "./utils/topicPairing.js";
import {
  buildSystemPrompt,
  buildHiddenWordsPrompt,
  buildLengthMatchPrompt,
} from "./ai/promptTemplates.js";

const GRID_MAX_LETTERS = 12;
const OK = /^[A-Z0-9_]+$/;

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const up = (s) => String(s || "").toUpperCase();
const upList = (arr) => (arr ?? []).map(up);

function stripCodeFences(str) {
  return str
    .replace(/^```(?:json)?/i, "") // remove starting ```json or ```
    .replace(/```$/i, "") // remove ending ```
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

  const {
    topic,
    difficulty,
    theme,
    topicWords,
    fixedPairs: fixedPairsFromCfg, // <- optional, user-provided
  } = puzzleConfig;

  // 1) Theme tokens (AI)
  console.log("🔹 Fetching theme tokens…");
  const hiddenTokens = await getHiddenTokens({ topic, phrase: theme.phrase });
  console.log("   → hiddenTokens:", hiddenTokens);

  // 2) Build typed anchors
  const anchors = buildAnchors(hiddenTokens, topicWords);

  // 3) OPTIONAL: fixed pairs come from config only (no hardcoding)
  const fixedPairs = (fixedPairsFromCfg ?? []).map(([a, b]) => [up(a), up(b)]);

  // 4) Local pairing
  const pairing = pairAnchorsWithConstraints(anchors, fixedPairs);
  console.log(
    `   → paired ${pairing.counts.paired} anchors, ${pairing.counts.unpaired} still need partners`
  );

  // 5) Ask AI only for missing partners (dictionary-first approach)
  let partners = [];
  if (pairing.anchorsNeedingPartners.length > 0) {
    console.log(
      `🔹 Requesting partners for ${pairing.anchorsNeedingPartners.length} anchors…`
    );

    for (const anchor of pairing.anchorsNeedingPartners) {
      // Step 5.1 – Fetch medical candidates of same length
      const candidates = await getMedicalWordsSameLength(anchor.word, topic);

      if (candidates.length > 0) {
        // Step 5.2 – Ask AI to choose from vetted list
        const system = buildSystemPrompt();
        const user = buildSelectionPrompt(anchor.word, candidates);
        try {
          const { original, suggestion } = await callJSON(system, user);
          partners.push({ original: up(original), suggestion: up(suggestion) });
        } catch (err) {
          console.error(`❌ Failed selection for ${anchor.word}`, err);
        }
      } else {
        // Step 5.3 – Fall back to generative prompt if no candidates found
        const system = buildSystemPrompt();
        const user = buildLengthMatchPrompt({
          topic,
          anchors: [anchor], // just this anchor
          excludeWords: pairing.excludeWords,
          fixedPairs,
          maxLettersPerToken: GRID_MAX_LETTERS,
        });
        try {
          const { partners: aiPartners = [] } = await callJSON(system, user);
          partners.push(
            ...aiPartners.map((p) => ({
              original: up(p.original),
              suggestion: up(p.suggestion),
            }))
          );
        } catch (err) {
          console.error(`❌ Failed generation for ${anchor.word}`, err);
        }
      }
    }

    console.log("   → AI partners count:", partners.length);
  }

  // 6) Validate + merge AI suggestions
  const excludeSet = new Set(pairing.excludeWords);
  const partnersMap = new Map();
  for (const p of partners) {
    const orig = up(p.original);
    const sugg = up(p.suggestion);
    if (validateSuggestion(orig, sugg, excludeSet)) {
      partnersMap.set(orig, sugg);
      excludeSet.add(sugg);
    }
  }

  const pairsFinal = [...pairing.pairs];
  for (const a of pairing.anchorsNeedingPartners) {
    const partner = partnersMap.get(a.word);
    if (partner) pairsFinal.push([a.word, partner]);
  }
  const finalWordList = Array.from(new Set(pairsFinal.flat()));

  // 7) Build foundation object
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
    pairing: {
      mode: "anchor+local",
      counts: pairing.counts,
      anchors,
      fixedPairs,
      local: pairing,
      aiPartners: partners,
      final: { pairsFinal, finalWordList },
    },
  };

  // 8) Save to file
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
