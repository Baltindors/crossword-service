// src/clueing/clueWriter.js
import fs from "fs/promises";
import OpenAI from "openai";

import { buildNumbering } from "../grid/numbering.js";
import { fromStrings } from "../grid/gridModel.js";
import { RULES } from "../config/rules.js";
import { buildSystemPrompt, buildCluePrompt } from "../ai/promptTemplates.js";

const DATA_DIR = "src/data";
const GRID_IN = `${DATA_DIR}/grid_final.json`;
const CLUES_OUT = `${DATA_DIR}/clues.json`;

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// remove accidental code fences from model output
function stripCodeFences(str) {
  return String(str || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

// robust JSON parse
function parseJSON(text) {
  const t = stripCodeFences(text);
  try {
    return JSON.parse(t);
  } catch (e) {
    throw new Error(`Invalid JSON from model:\n${t}`);
  }
}

/**
 * Generate clues for given across/down entry lists using OpenAI.
 * entries shape: [{ num, answer }]
 * Returns { across: [{num, answer, clue}], down: [...] }
 */
export async function generateClues({
  topic,
  difficulty = 5,
  acrossEntries = [],
  downEntries = [],
  batchSize = 40,
}) {
  // simple batching in case the list is long
  const batches = [];
  const total = acrossEntries.length + downEntries.length;
  if (total === 0) return { across: [], down: [] };

  const makeBatch = (startIdx, endIdx, arr) => arr.slice(startIdx, endIdx);

  if (total <= batchSize) {
    batches.push({ across: acrossEntries, down: downEntries });
  } else {
    // split both arrays into chunks while preserving order
    let a = 0,
      d = 0;
    while (a < acrossEntries.length || d < downEntries.length) {
      const room = batchSize;
      const aTake = Math.min(room, acrossEntries.length - a);
      const dTake = Math.min(room - aTake, downEntries.length - d);
      batches.push({
        across: makeBatch(a, a + aTake, acrossEntries),
        down: makeBatch(d, d + dTake, downEntries),
      });
      a += aTake;
      d += dTake;
    }
  }

  const outAcross = [];
  const outDown = [];

  for (const b of batches) {
    const sys = buildSystemPrompt();
    const user = buildCluePrompt({
      topic,
      difficulty,
      acrossEntries: b.across,
      downEntries: b.down,
    });

    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "system", content: sys }, user],
      temperature: 0,
    });

    const json = parseJSON(res.choices?.[0]?.message?.content ?? "{}");

    // Merge preserving original order by num
    const aByNum = new Map((json.across || []).map((x) => [x.num, x]));
    const dByNum = new Map((json.down || []).map((x) => [x.num, x]));

    for (const e of b.across) {
      const got = aByNum.get(e.num);
      if (got?.clue && typeof got.clue === "string") {
        outAcross.push({ num: e.num, answer: e.answer, clue: got.clue });
      } else {
        // fallback: empty clue placeholder
        outAcross.push({ num: e.num, answer: e.answer, clue: "" });
      }
    }
    for (const e of b.down) {
      const got = dByNum.get(e.num);
      if (got?.clue && typeof got.clue === "string") {
        outDown.push({ num: e.num, answer: e.answer, clue: got.clue });
      } else {
        outDown.push({ num: e.num, answer: e.answer, clue: "" });
      }
    }
  }

  return { across: outAcross, down: outDown };
}

/**
 * Convenience: read grid_final.json, derive numbered entries, call OpenAI, write clues.json.
 * Returns { across, down, writtenPath }.
 */
export async function writeCluesFromGrid({
  topic,
  difficulty = 5,
  gridPath = GRID_IN,
  outPath = CLUES_OUT,
  batchSize = 40,
}) {
  await fs.mkdir(DATA_DIR, { recursive: true });

  // 1) Load solved grid + assignments
  const gridDoc = JSON.parse(await fs.readFile(gridPath, "utf8"));
  const grid = fromStrings(gridDoc.grid);
  const assignments = new Map(
    (gridDoc.assignments || []).map(({ slotId, word }) => [
      slotId,
      String(word || "").toUpperCase(),
    ])
  );

  // 2) Numbering
  const { across, down } = buildNumbering(grid, assignments);

  // 3) Build minimal entry lists for the prompt
  // Prefer assignment answers; if missing, derive from pattern (grid should be fully filled at this point)
  const acrossEntries = across.map((e) => ({
    num: e.num,
    answer: deriveAnswer(e, grid),
  }));
  const downEntries = down.map((e) => ({
    num: e.num,
    answer: deriveAnswer(e, grid),
  }));

  // 4) Generate clues
  const { across: outAcross, down: outDown } = await generateClues({
    topic,
    difficulty,
    acrossEntries,
    downEntries,
    batchSize,
  });

  // 5) Persist
  const doc = {
    topic,
    difficulty,
    across: outAcross,
    down: outDown,
    writtenAt: new Date().toISOString(),
  };
  await fs.writeFile(outPath, JSON.stringify(doc, null, 2));

  console.log(`📝 Wrote clues to ${outPath}`);
  return { across: outAcross, down: outDown, writtenPath: outPath };
}

// ---- helpers ----

function deriveAnswer(entry, grid) {
  // entry has row/col/length and pattern; grid should have letters in place
  const { num, slotId, length, pattern } = entry;
  const ans = String(entry.answer || pattern || "")
    .toUpperCase()
    .replace(/\./g, "");
  // sanity guard: ensure regex + length
  if (ans.length === length && RULES.tokenRegex.test(ans)) {
    return ans;
  }
  // fallback to stripping unknown chars (should not happen in solved grid)
  return ans.replace(new RegExp(RULES.unknownChar, "g"), "");
}
