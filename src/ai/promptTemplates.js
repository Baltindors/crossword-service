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

// 1) Hidden words / tokens from theme phrase (length-capped per token)
export function buildHiddenWordsPrompt({
  topic,
  themePhrase,
  maxLettersPerToken = 12, // per-token max length (e.g., grid width/height)
}) {
  return {
    role: "user",
    content: `
TASK: Split the theme phrase into hidden tokens suitable for embedding into crossword entries.

INPUT:
topic: ${topic}
themePhrase: ${themePhrase}
maxLettersPerToken: ${maxLettersPerToken}

REQUIREMENTS:
- Preserve order: tokens must appear in the SAME SEQUENCE as in the original phrase.
- Each token must be a CONTIGUOUS run of letters from the phrase (ignore spaces/punctuation).
- Do NOT return any token longer than maxLettersPerToken.
- If any single word in the phrase exceeds maxLettersPerToken, split it into smaller contiguous segments.
- Prefer splits that produce medically meaningful substrings when natural; otherwise split along word boundaries.
- Uppercase all tokens.
- OUTPUT STRICT JSON ONLY (no prose, no markdown).

OUTPUT:
{
  "hiddenWordsOrdered": ["TOKEN1","TOKEN2","..."]  // every token.length <= maxLettersPerToken
}`,
  };
}

// -------- 2) Length-match replacements for unpaired topic words ----------
/**
 * For any topic words you can't locally pair by length, ask for same-length, on-topic
 * suggestions to pair with. You pass only the unpaired list.
 */
export function buildSelectionPrompt({
  topic,
  anchor, // { word:"KNOW", length:4 }
  candidates, // array of exact-length candidates from dictionary
  excludeWords, // strings to avoid
}) {
  return {
    role: "user",
    content: `
Select the most appropriate medically relevant word from the provided list for the anchor "${
      anchor.word
    }".

TOPIC: ${topic}
ANCHOR LENGTH: ${anchor.length}
EXCLUDE WORDS: ${JSON.stringify(excludeWords)}
CANDIDATES: ${JSON.stringify(candidates)}

RULES:
- Choose exactly one word from the candidates list.
- Do NOT modify or invent new words.
- Must not choose anything from EXCLUDE WORDS.
- Preserve case as uppercase in your suggestion.
- Output strict JSON only.

OUTPUT FORMAT:
{ "original": "${anchor.word}", "suggestion": "<CHOSEN_WORD>" }
    `.trim(),
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
