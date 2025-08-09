// src/config/puzzleConfig.js

export const puzzleConfig = {
  // short label for this puzzle batch this will help prioratize words
  topic: "HIV Prevention",

  // difficulty level, 1 (easiest) through 7 (hardest)
  difficulty: 5,

  // the theme of the puzzle, used to generate the puzzle and hidden words
  theme: {
    phrase: "KNOW YOURS STATUS",
    instructions:
      "Weave the hidden motif 'KNOW YOUR STATUS' into three spans each span should appear as part of a longer entry",
  },

  //words that must be included in the puzzle
  topicWords: [
    "RETROVIRAL",
    "PROPHYLAXIS",
    "VIRALLOAD",
    "ELISA",
    "CD4COUNT",
    "TRUVADA",
    "DESCOVY",
  ],
};
