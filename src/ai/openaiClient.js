import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

// Create the OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Sends a prompt to OpenAI's Chat API and returns the response text.
 * @param {string} prompt - The prompt/question to send to the model.
 * @returns {Promise<string>} - The AI's text response.
 */
export async function getAIResponse(prompt) {
  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
    throw error;
  }
}
