export function buildSystemPrompt() {
  return `You are MedicalCrosswordFiller.
You generate medically accurate word lists and 12×12 crossword fills for a medical audience.
Rules you MUST follow:
- Grid is 12 rows x 12 columns.
- Enforce 180° rotational symmetry: cell (r,c) mirrors to (13-r, 13-c).
- Across/Down entries must be >= 3 letters; every white cell belongs to both an Across and a Down entry.
- Prefer medically relevant vocabulary for the requested topic.
- Embed the hidden theme phrase by splitting it across long entries where possible.
- Try to meet the difficulty by the dificulty of the clue and the word itself (1 easiest, 7 hardest).
- OUTPUT STRICT JSON ONLY (no prose, no markdown). Schema below.`;
}

export function buildUserPrompt({ topic, difficulty, theme, topicWords }) {
  const targetBlacksByDifficulty = {
    // tweak to taste
    1: 24,
    2: 24,
    3: 22,
    4: 22,
    5: 20,
    6: 20,
    7: 18,
  };
  const targetBlacks = targetBlacksByDifficulty[difficulty] ?? 18;

  return {
    role: "user",
    content: `INPUT:
topic: ${topic}
difficulty: ${difficulty} (target black squares ≈ ${targetBlacks})
hiddenPhrase: ${theme.phrase}
specialInstructions: ${theme.instructions}

seedTopicWords: ${topicWords.join(", ")}

TASKS:
1) Expand medical topic words to at least 10 total items. Use uppercase, no spaces (use underscores ONLY if medically standard). Keep domain-specific validity.
2) Pair words by identical length. If any word cannot be paired, propose new medically valid words of matching length to complete pairs.
3) Produce a 12x12 grid (array of 12 arrays, each 12 single-character strings). Use uppercase letters A–Z or "." for black squares. Enforce 180° symmetry and 3+ letter entries. Embed the hidden phrase across longer entries.
4) Aim for ~${targetBlacks} black squares.

OUTPUT (JSON ONLY):
{
  "expandedTopicWords": ["..."],
  "pairedByLength": [["WORD1","WORD2"], ["WORD3","WORD4"], ...],
  "grid": [
    ["A",".","B",...],   // 12 chars
    ...                  // 12 rows
  ]
}`,
  };
}
