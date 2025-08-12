// src/ai/promptTemplates.js

// -------- Shared system prompt (used for all calls) ----------
export function buildSystemPrompt() {
  return [
    "You are MedicalCrosswordFiller.",
    "Audience: medical professionals; US English.",
    "Always return STRICT JSON only (no prose, no markdown, no code fences).",
    "All answer tokens must be uppercase and match ^[A-Z0-9_]+$.",
    "Never invent non-words; if no valid result, return nulls or empty arrays as specified.",
    "Do not include PHI or unsafe/stigmatizing content.",
  ].join(" ");
}

// -------- 1) Hidden tokens from theme phrase (minimal AI) ----------
export function buildHiddenWordsPrompt({
  topic,
  themePhrase,
  maxLettersPerToken = 12,
  maxTokens = 24,
}) {
  return {
    role: "user",
    content: JSON.stringify({
      task: "extract_hidden_tokens",
      topic,
      themePhrase,
      constraints: {
        preserveOrder: true,
        contiguousFromPhrase: true,
        regex: "^[A-Z0-9_]+$",
        maxLettersPerToken,
        maxTokens,
        uppercase: true,
      },
      guidance: [
        "Ignore spaces/punctuation in the phrase.",
        "If a word exceeds maxLettersPerToken, split into smaller contiguous segments.",
        "Prefer splits that yield medically meaningful substrings; otherwise split at word boundaries.",
      ],
      output: { shape: { hiddenWordsOrdered: ["TOKEN"] } },
    }),
  };
}

// -------- 2) (Optional) Choose ONE from candidates for an anchor ----------
// Not used in the new index, but handy for special cases.
export function buildSelectionPrompt({
  topic,
  anchor,
  candidates,
  excludeWords,
}) {
  return {
    role: "user",
    content: JSON.stringify({
      task: "choose_from_candidates",
      topic,
      anchor: { word: anchor.word, length: anchor.length },
      candidates, // keep ≤ ~15 before calling
      excludeWords: Array.from(new Set(excludeWords || [])),
      rules: [
        "Pick EXACTLY ONE word from candidates (verbatim match).",
        "Same length as anchor.length.",
        "Match ^[A-Z0-9_]+$.",
        "Must not equal anchor.word.",
        "Must not appear in excludeWords.",
      ],
      onNoValidChoice: 'Return {"suggestion": null}.',
      output: { shape: { suggestion: "STRING|null" } },
    }),
  };
}

// -------- 3) (Optional) Theme containers: longer real words containing a token ----------
// If you prefer to mine containers from dictionaries only, you can skip this entirely.
export function buildThemeContainersPrompt({
  topic,
  token, // e.g., "STATUS"
  minExtraLetters = 2, // token length + 2 .. +6 (tunable)
  maxExtraLetters = 6,
  maxPerToken = 20,
}) {
  return {
    role: "user",
    content: JSON.stringify({
      task: "propose_theme_containers",
      topic,
      token,
      rules: [
        "Return REAL words only that contain the token as a contiguous substring.",
        "Uppercase; must match ^[A-Z0-9_]+$.",
        `Length must be token.length + ${minExtraLetters} .. token.length + ${maxExtraLetters}.`,
      ],
      caps: { maxPerToken },
      output: { shape: { containers: ["WORD"] } },
    }),
  };
}

// -------- 4) (Optional QA) Propose filler words for a grid ----------
// Your solver should do fills locally; this is only for experiments or fallback.
export function buildFillerWordsPrompt({ topic, grid }) {
  return {
    role: "user",
    content: JSON.stringify({
      task: "propose_filler_for_grid",
      topic,
      grid, // 12x12: '.' for blocks, 'A'-'Z' fixed, '_' unknown (optional)
      rules: [
        "Every Across/Down entry must be a real word (prefer medical).",
        "Do not change existing letters or '.' positions.",
        "Only propose 3+ letter entries.",
      ],
      output: {
        shape: {
          filler: [
            {
              orientation: "ACROSS|DOWN",
              row: 0,
              col: 0,
              answer: "WORD",
              definition: "STRING",
            },
          ],
        },
      },
    }),
  };
}

// -------- 5) (Optional QA) Validate grid words ----------
// Again, your solver should ensure validity; this is a secondary check if desired.
export function buildValidationPrompt({ grid }) {
  return {
    role: "user",
    content: JSON.stringify({
      task: "validate_grid",
      grid, // 12x12 with '.' blocks and letters elsewhere
      checks: [
        "Every horizontal/vertical contiguous run of letters (length ≥3) must be a recognized word.",
        "Do not modify the grid.",
      ],
      output: {
        shape: {
          isValid: true,
          invalid: [
            {
              orientation: "ACROSS|DOWN",
              row: 0,
              colStart: 0,
              length: 5,
              string: "ABCDE",
              reason: "not recognized",
            },
          ],
        },
      },
    }),
  };
}

// -------- 6) Clue generation (the one AI step you definitely keep) ----------
export function buildCluePrompt({
  topic,
  difficulty,
  acrossEntries,
  downEntries,
}) {
  return {
    role: "user",
    content: JSON.stringify({
      task: "write_medical_crossword_clues",
      topic,
      difficulty, // 1 easiest .. 7 hardest
      entries: { across: acrossEntries, down: downEntries },
      guidelines: [
        "Audience: clinicians.",
        "Difficulty: 1–2=definition-forward; 3–4=light indirection/abbrev; 5–6=clinical nuance; 7=specialist-level nuance.",
        "Avoid answer giveaways; use accepted abbreviations with markers (e.g., 'abbr.').",
        "Keep clues concise (ideally ≤12 words).",
        "No stigma, no medical advice.",
      ],
      output: {
        shape: {
          across: [
            {
              num: 1,
              answer: "ELISA",
              clue: "Antibody-based HIV screening test",
            },
          ],
          down: [
            {
              num: 2,
              answer: "TRUVADA",
              clue: "Tenofovir/emtricitabine combo for PrEP",
            },
          ],
        },
      },
    }),
  };
}
