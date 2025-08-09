export async function chatWithOllama({ model, messages, stream = false }) {
  const url = `${process.env.OLLAMA_URL}/api/chat`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error: ${res.status} ${text}`);
  }

  const data = await res.json();
  // Ollama /api/chat typically returns { message: { content } } (non-stream)
  return data?.message?.content ?? "";
}
