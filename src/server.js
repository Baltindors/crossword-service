import express from "express";
import { readFile } from "fs/promises";
import { PORT, FOUNDATION_FILE_PATH } from "./utils/constants.js";

const app = express();
const PORT = PORT;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Crossword service is up and running!");
});

app.get("/foundation", async (req, res) => {
  const data = await readFile(FOUNDATION_FILE_PATH, "utf8");
  res.json(JSON.parse(data));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
