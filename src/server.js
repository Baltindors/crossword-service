import express from "express";
import { readFile } from "fs/promises";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Crossword service is up and running!");
});

app.get("/foundation", async (req, res) => {
  const data = await readFile("src/data/foundation.json", "utf8");
  res.json(JSON.parse(data));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
