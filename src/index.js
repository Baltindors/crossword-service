import express from "express";
import { puzzleConfig } from "./config/puzzleConfig.js";
import dotenv from "dotenv";

const app = express();
const PORT = process.env.PORT || 3000;

// middleware to parse JSON bodies
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Crossword service is up and running!");
});

// start listening
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

console.log(puzzleConfig.theme.instructions);
