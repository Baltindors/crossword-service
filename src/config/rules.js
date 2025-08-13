// src/config/rules.js
export const RULES = {
  // Grid + symbols
  allowedGridSizes: [12], // extend later: [11,12,13,15]
  blockChar: ".",
  unknownChar: "_",

  // Crossword style
  symmetry: "rotational-180", // enforced on place/remove block
  americanStyle: true, // every letter checked; no unchecked cells
  minEntryLen: 3, // no 2-letter entries
  requireConnectivity: true, // one connected white-cell component

  // Tokens/answers
  tokenRegex: /^[A-Z0-9_]+$/, // normalize() must satisfy this
  upperCaseAnswers: true,

  // Validation toggles
  enforceNoTwoLetter: true,
  enforceCheckedLetters: true,
};

// Optional tiny helpers used across the app
export const isValidToken = (s) => RULES.tokenRegex.test(String(s || ""));
export const normalizeToken = (s) =>
  String(s || "")
    .toUpperCase()
    .replace(/\s+/g, "");

export function assertGridSize(n) {
  if (!RULES.allowedGridSizes.includes(n)) {
    throw new Error(
      `Grid size ${n} not allowed. Allowed: ${RULES.allowedGridSizes.join(
        ", "
      )}`
    );
  }
}
