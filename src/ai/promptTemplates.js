// src/ai/promptTemplates.js

// -------- Shared system prompt (used for all calls) ----------
export function buildSystemPrompt() {
  return [
    "You are MedicalCrosswordFiller, an expert assistant for creating medical-themed crossword puzzles for healthcare professionals.",
    "You must always return a single, valid JSON object.",
    "Do not include any explanatory text, markdown, or code fences in your response.",
    "All crossword answers must be uppercase and match the regex: ^[A-Z0-9_]+$.",
    "Never invent words. If you cannot find a valid answer, return null or an empty array as specified in the task.",
    "Content must be accurate, professional, and free of stigmatizing language.",
  ].join(" ");
}

// -------- 1) Brainstorm theme and topic words with user guidance ----------
export function buildThemeWordsPrompt({
  topic,
  positivePrompt, // New field
  negativePrompt, // New field
  wordCount = 30,
  maxLength = 12,
}) {
  return {
    role: "user",
    content: JSON.stringify({
      task: "brainstorm_theme_words",
      topic,
      guidance: {
        include: positivePrompt, // AI will prioritize these concepts
        exclude: negativePrompt, // AI will avoid these concepts
        general:
          "Generate a diverse list of medically-relevant words and phrases related to the topic. Include a mix of lengths. Prefer single, common words over obscure multi-word phrases.",
      },
      constraints: {
        wordCount,
        maxLength,
        minWordLength: 3,
        regex: "^[A-Z0-9_]+$",
        uppercase: true,
      },
      outputShape: {
        themeWords: ["WORD1", "WORD2", "WORD3"],
      },
    }),
  };
}

// -------- 2) Hidden tokens from theme phrase (kept for legacy use) ----------
export function buildHiddenWordsPrompt({
  topic,
  themePhrase,
  maxLettersPerToken = 12,
  maxTokens = 8,
}) {
  return {
    role: "user",
    content: JSON.stringify({
      task: "extract_hidden_tokens",
      topic,
      themePhrase,
      constraints: {
        preserveOrder: true,
        regex: "^[A-Z0-9_]+$",
        maxLettersPerToken,
        maxTokens,
        uppercase: true,
      },
      guidance:
        "Split the theme phrase into meaningful, medically-relevant tokens. Prefer whole words but split longer words if necessary to meet length constraints.",
      outputShape: { hiddenWordsOrdered: ["TOKEN1", "TOKEN2"] },
    }),
  };
}

// -------- 3) Clue generation (post-solve) ----------
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
      difficulty,
      entries: {
        across: acrossEntries,
        down: downEntries,
      },
      guidelines: [
        "Generate a concise, medically accurate clue for each answer.",
        "Adjust clue difficulty based on the provided level (1=straightforward definition, 7=requires deep specialist knowledge).",
        "Use standard medical abbreviations only when appropriate, marked with '(abbr.)'.",
        "Keep clues short (under 12 words is ideal).",
        "Do not include the answer in the clue.",
        "Avoid medical advice and stigmatizing language.",
      ],
      outputShape: {
        across: [
          {
            num: 1,
            answer: "ELISA",
            clue: "Common HIV screening test (abbr.)",
          },
        ],
        down: [
          {
            num: 2,
            answer: "TRUVADA",
            clue: "Brand name for emtricitabine/tenofovir PrEP",
          },
        ],
      },
    }),
  };
}
