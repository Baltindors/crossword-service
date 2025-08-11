// src/index.js
import "dotenv/config"; // load env FIRST
import fs from "fs/promises";
import OpenAI from "openai";

import { GRID_MAX_LETTERS } from "./utils/constants.js";
import { puzzleConfig } from "./config/puzzleConfig.js";
import { buildCandidatePools } from "./utils/dictionary.js"; // <-- new length-aware pools
import {
  buildAnchors,
  pairAnchorsWithConstraints,
} from "./utils/topicPairing.js";
import {
  buildSystemPrompt,
  buildHiddenWordsPrompt,
  buildSelectionPrompt, // returns { suggestion }
} from "./ai/promptTemplates.js";

const OK = /^[A-Z0-9_]+$/;
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

function validateSuggestion(orig, sugg, excludeSet) {
  if (!orig || !sugg) return false;
  if (!OK.test(sugg)) return false;
  if (sugg.length !== orig.length) return false;
  if (excludeSet.has(sugg)) return false;
  if (sugg === orig) return false;
  return true;
}

async function main() {
  console.log("Anchor pairing pipeline starting…");
  await fs.mkdir("src/data", { recursive: true });

  try {
    await fs.rm("src/data/foundation.json", { force: true });
  } catch (e) {
    // ignore ENOENT; rethrow others if you want
    if (e.code !== "ENOENT") throw e;
  }

  const {
    topic,
    difficulty,
    theme,
    topicWords,
    fixedPairs: fixedPairsFromCfg,
  } = puzzleConfig;

  // 1) Theme tokens (AI)
  console.log("🔹 Fetching theme tokens…");
  const hiddenTokens = await getHiddenTokens({ topic, phrase: theme.phrase });
  console.log("   → hiddenTokens:", hiddenTokens);

  // 2) Build typed anchors (theme first)
  const anchors = buildAnchors(hiddenTokens, topicWords);

  // 3) Optional fixedPairs from config (uppercased)
  const fixedPairs = (fixedPairsFromCfg ?? []).map(([a, b]) => [up(a), up(b)]);

  // 4) Local deterministic pairing (theme↔topic, then topic↔topic; never theme↔theme)
  const pairing = pairAnchorsWithConstraints(anchors, fixedPairs);
  console.log(
    `   → paired ${pairing.counts.paired} anchors, ${pairing.counts.unpaired} still need partners`
  );

  // 5) Build OneLook candidate pools by needed lengths (to keep prompts small + accurate)
  const neededLengths = [
    ...new Set(pairing.anchorsNeedingPartners.map((a) => a.length)),
  ].sort((a, b) => a - b);
  const pools = await buildCandidatePools({
    topic,
    lengths: neededLengths,
    perLength: 20, // adjust 10–30 as you like
  });

  // 6) AI selection pass, deterministic order of anchors: (len ASC, word ASC)
  const excludeSet = new Set(pairing.excludeWords);
  const aiPartners = [];

  const anchorsNeedingPartnersSorted = [...pairing.anchorsNeedingPartners].sort(
    (a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      return a.word.localeCompare(b.word);
    }
  );

  for (const anchor of anchorsNeedingPartnersSorted) {
    const original = up(anchor.word);
    const pool = (pools.get(anchor.length) || []).filter(
      (w) => w !== original && !excludeSet.has(w)
    );

    // Cap prompt size but keep top-scored words (pools already sorted by score)
    const candidates = pool.slice(0, 15);

    try {
      if (candidates.length > 0) {
        const system = buildSystemPrompt();
        const user = buildSelectionPrompt({
          topic,
          anchor,
          candidates,
          excludeWords: Array.from(excludeSet),
        });
        const out = await callJSON(system, user);
        const suggestion = up(out?.suggestion ?? "");

        if (validateSuggestion(original, suggestion, excludeSet)) {
          aiPartners.push({ original, suggestion });
          excludeSet.add(suggestion);
        } else {
          console.warn(`⚠️ Rejected AI pick for ${original}: "${suggestion}"`);
          // Optional deterministic fallback: first unused candidate
          const fallback = candidates.find((c) =>
            validateSuggestion(original, c, excludeSet)
          );
          if (fallback) {
            aiPartners.push({ original, suggestion: fallback });
            excludeSet.add(fallback);
            console.warn(`   ↳ Used fallback candidate: "${fallback}"`);
          }
        }
      } else {
        console.warn(
          `⚠️ No candidates for ${original} (len=${anchor.length}). Skipping.`
        );
      }
    } catch (err) {
      console.error(`❌ AI selection failed for ${original}`, err);
      // Optional deterministic fallback on error
      const fallback = candidates.find((c) =>
        validateSuggestion(original, c, excludeSet)
      );
      if (fallback) {
        aiPartners.push({ original, suggestion: fallback });
        excludeSet.add(fallback);
        console.warn(`   ↳ Used fallback candidate after error: "${fallback}"`);
      }
    }
  }

  // 7) Merge to final pairs
  const partnersMap = new Map(
    aiPartners.map((p) => [p.original, p.suggestion])
  );
  const pairsFinal = [...pairing.pairs];
  for (const a of pairing.anchorsNeedingPartners) {
    const partner = partnersMap.get(up(a.word));
    if (partner) pairsFinal.push([up(a.word), partner]);
  }
  const finalWordList = Array.from(new Set(pairsFinal.flat()));

  // 8) Build foundation object
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
      mode: "anchor+local+onelook",
      counts: pairing.counts,
      anchors,
      fixedPairs,
      local: pairing,
      aiPartners,
      final: { pairsFinal, finalWordList },
    },
  };

  // 9) Save to file
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
