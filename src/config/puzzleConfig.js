// src/config/puzzleConfig.js

export const puzzleConfig = {
  // short label for this puzzle batch this will help prioratize words
  topic: "HIV Prevention",

  // difficulty level, 1 (easiest) through 7 (hardest)
  difficulty: 1,

  // the theme of the puzzle, used to generate the puzzle and hidden words
  theme: {
    phrase: "CARE FOR OTHERS",
    instructions:
      "Weave the hidden motif 'CARE FOR OTHERS' into three spans each span should appear as part of a longer entry",
  },

  //words that must be included in the puzzle
  topicWords: [
    "ANTIBODIES",
    "PROPHYLAXIS",
    "VIRALLOAD",
    "ELISA",
    "CD4COUNT",
    "TRUVADA",
    "DESCOVY",
  ],
};
