// -------- Shared system prompt (used for all calls) ----------
export function buildSystemPrompt() {
  return `
You are MedicalCrosswordFiller.
You generate medically accurate word lists, validate crossword fills, and write professional clues.

Hard rules:
- Audience: medical professionals.
- US English; uppercase answers.
- No PHI or unsafe content.
- Never invent non-words. If unsure, omit.
- OUTPUT STRICT JSON ONLY (no prose, no markdown).`;
}

// -------- 1) Understand topic + derive hidden words -----------
/**
 * Ask the model to parse the theme phrase into <= maxHiddenWords tokens,
 * preserving order, suitable to hide inside longer entries.
 */
export function buildHiddenWordsPrompt({
  topic,
  themePhrase,
  maxHiddenWords = 12,
}) {
  return {
    role: "user",
    content: `
TASK: Parse the theme for hidden tokens while understanding the puzzle topic.

INPUT:
topic: ${topic}
themePhrase: ${themePhrase}
maxHiddenWords: ${maxHiddenWords}

REQUIREMENTS:
- Return hidden tokens IN ORDER they appear in the phrase.
- Do not exceed maxHiddenWords.
- Tokens should be contiguous letter runs (ignore punctuation); prefer medically meaningful splits if natural, otherwise default to word boundaries.
- Uppercase all tokens.

OUTPUT (JSON ONLY):
{
  "topicSummary": "1-2 sentence medical framing of the topic",
  "hiddenWordsOrdered": ["TOKEN1","TOKEN2", "..."]  // length <= ${maxHiddenWords}
}`,
  };
}

// -------- 2) Length-match replacements for unpaired topic words ----------
/**
 * For any topic words you can't locally pair by length, ask for same-length, on-topic
 * suggestions to pair with. You pass only the unpaired list.
 */
export function buildLengthMatchPrompt({ topic, unpairedWords }) {
  return {
    role: "user",
    content: `
TASK: For each UNPAIRED topic word, propose ONE medically valid word of the SAME LENGTH to enable pairing.

INPUT:
topic: ${topic}
unpairedWords: [${unpairedWords.map((w) => `"${w}"`).join(", ")}]

RULES:
- EXACT SAME LENGTH per item.
- Strong topical relevance preferred; avoid trademarks unless widely standard in clinical usage.
- Uppercase; no spaces (use underscores ONLY if medically standard, e.g., "CD4_COUNT").

OUTPUT (JSON ONLY):
{
  "matches": [
    { "original":"RETROVIRAL", "suggestion":"ANTIVIRALS", "length":10, "rationale":"..." }
  ]
}`,
  };
}

// -------- 3a) Propose filler words for a given 12x12 grid ----------
/**
 * You give a 12x12 with letters for fixed entries and '.' for blacks and
 * '_' for unknown letters (optional). Model returns ONLY filler words to place.
 */
export function buildFillerWordsPrompt({ topic, grid }) {
  return {
    role: "user",
    content: `
TASK: Propose filler words to complete the crossword.

INPUT:
topic: ${topic}
grid: A 12x12 array of strings. Use "." for black squares; letters A–Z where fixed;
"_" may appear for unknown letters to be filled.

GRID:
${JSON.stringify(grid)}

RULES:
- Every Across and Down entry must be a real word (general or medical). Prefer medical when possible.
- Do not change existing letters or '.' positions.
- Return only the filler entries (answers with coordinates). Coordinates are 0-based.
- 3+ letters per entry.

OUTPUT (JSON ONLY):
{
  "filler": [
    {
      "orientation":"ACROSS",
      "row": 3,
      "colStart": 0,
      "answer":"ELISA",
      "definition":"..."
    },
    {
      "orientation":"DOWN",
      "col": 5,
      "rowStart": 1,
      "answer":"PRION",
      "definition":"..."
    }
  ]
}`,
  };
}

// -------- 3b) Validate that all rows/cols form real words ----------
/**
 * Ask only for validation — helpful as a separate check.
 */
export function buildValidationPrompt({ grid }) {
  return {
    role: "user",
    content: `
TASK: Validate a 12x12 crossword grid.

INPUT GRID (12x12; "." are blacks; A–Z letters elsewhere):
${JSON.stringify(grid)}

CHECKS:
- Every horizontal and vertical contiguous run of letters (3+ length) must be a real word.
- Do not modify the grid. Return validity and list any invalid entries with coordinates.

OUTPUT (JSON ONLY):
{
  "isValid": true,
  "invalid": [
    {
      "orientation": "ACROSS",
      "row": 7,
      "colStart": 2,
      "length": 5,
      "string": "ABCDE",
      "reason": "not a recognized word"
    }
  ]
}`,
  };
}

// -------- 4) Professional clues for all entries ----------
/**
 * Provide clues for Across/Down answers you supply.
 * You pass answers with numbering & positions; model returns clues at given difficulty.
 */
export function buildCluePrompt({
  topic,
  difficulty,
  acrossEntries,
  downEntries,
}) {
  return {
    role: "user",
    content: `
TASK: Write concise, professional clues for a medical crossword.

INPUT:
topic: ${topic}
difficulty: ${difficulty}  // 1 easiest .. 7 hardest
acrossEntries: ${JSON.stringify(acrossEntries)}
downEntries: ${JSON.stringify(downEntries)}

GUIDELINES:
- Audience: clinicians. Calibrate difficulty as:
  1–2 = straightforward definition; 3–4 = light indirection/abbrev; 5–6 = clinical nuance; 7 = specialist-level nuance.
- Avoid giveaways (repeat of answer). Use accepted abbreviations where appropriate.
- Keep clues crisp (ideally ≤12 words). Include abbrev markers where relevant (e.g., "abbr.").

OUTPUT (JSON ONLY):
{
  "across": [ { "num":1, "answer":"ELISA", "clue":"Antibody-based test for HIV screening" } ],
  "down":   [ { "num":2, "answer":"TRUVADA", "clue":"Tenofovir/emtricitabine combo for PrEP" } ]
}`,
  };
}
