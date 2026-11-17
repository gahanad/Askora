
import { loadEnvConfig } from "@next/env";
import { GoogleGenAI } from "@google/genai";

loadEnvConfig(process.cwd());

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const ai = new GoogleGenAI({ apiKey });

  console.log("Testing Gemini direct API...");
  console.log("Model:", process.env.GEMINI_TEXT_MODEL);

  const start = Date.now();

  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_TEXT_MODEL || "gemini-3.8-flash",
      contents: "Reply with exactly: API WORKING",
    });

    console.log("Response:", response.text);
    console.log("Duration:", Date.now() - start, "ms");
  } catch (error) {
    console.error("Direct API error:", error);
  }
}

main().catch(console.error);
