// src/config/puzzleConfig.js

export const puzzleConfig = {
  // The main theme for the AI to brainstorm around.
  topic: "Medical Imaging",

  // Further clarification for the AI on what to include.
  positivePrompt:
    "Include terms related to X-ray, MRI, and ultrasound procedures, as well as common anatomical terms seen in scans.",

  // Specific guidance on what the AI should avoid.
  negativePrompt:
    "Avoid overly technical physics terms, brand names of equipment, and rare or obscure imaging techniques.",

  // Difficulty level, 1 (easiest) through 7 (hardest).
  difficulty: 1,
};
