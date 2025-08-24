// src/solver/providers/onelook.js
// OneLook/Datamuse "sp=" pattern search (e.g., A??C??).
// If you're on Node < 18, install 'node-fetch' and import it instead.
export async function fetchOneLookByPattern(
  pattern,
  { max = 200, signal } = {}
) {
  const u = new URL("https://api.datamuse.com/words");
  u.searchParams.set("sp", pattern);
  u.searchParams.set("max", String(max));

  const res = await fetch(u, { signal });
  if (!res.ok) throw new Error(`OneLook fetch failed: ${res.status}`);
  const data = await res.json();

  return data
    .map((d) => (d.word || "").toUpperCase())
    .filter((w) => /^[A-Z]+$/.test(w));
}
