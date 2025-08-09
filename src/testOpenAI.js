import { getAIResponse } from "./ai/openaiClient.js";

const prompt = "Give me 5 common 4-letter word animals in uppercase.";

getAIResponse(prompt)
  .then((result) => {
    console.log("OpenAI Response:", result);
  })
  .catch((err) => {
    console.error("Error:", err);
  });
