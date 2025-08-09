import fetch from "node-fetch";

// Example Onelook lookup
export async function getMedicalWordsSameLength(anchor, topic) {
  const length = anchor.length;
  const resp = await fetch(
    `https://api.onelook.com/words?ml=${encodeURIComponent(
      topic
    )}&topics=medical&max=500`
  );
  const data = await resp.json();
  return data
    .map((w) => w.word.toUpperCase())
    .filter((w) => w.length === length && /^[A-Z0-9_]+$/.test(w));
}
