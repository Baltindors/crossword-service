// src/solver/onelook.js
import fetch from "node-fetch";

const OK = /^[A-Z0-9_]+$/;

async function fetchFromApi(url, L, up) {
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[API Fetch] ${res.status}`, await res.text());
    return [];
  }
  const raw = await res.json();
  const seen = new Set();
  const out = [];
  for (const item of raw || []) {
    const w = up(item?.word);
    if (!OK.test(w) || w.length !== L) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

export async function fetchOneLookByPattern(pattern, { max = 200 } = {}) {
  const u = new URL("https://api.onelook.com/words");
  u.searchParams.set("sp", pattern);
  u.searchParams.set("max", String(max));
  return await fetchFromApi(u.toString(), pattern.length, (s) =>
    String(s || "").toUpperCase()
  );
}
