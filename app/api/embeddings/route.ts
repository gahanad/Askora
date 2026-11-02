
import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";


export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured." },
        { status: 500 }
      );
    }

    const body: unknown = await request.json();

    if (
      typeof body !== "object" ||
      body === null ||
      !("text" in body) ||
      typeof body.text !== "string"
    ) {
      return NextResponse.json(
        { error: "Provide a text string." },
        { status: 400 }
      );
    }

    const text = body.text.trim();

    if (!text || text.length > 1000) {
      return NextResponse.json(
        { error: "Question must contain 1–1000 characters." },
        { status: 400 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.embedContent({
      model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
      contents: text,
    });

    const embedding = response.embeddings?.[0]?.values;

    if (!embedding || embedding.length === 0) {
      throw new Error("The embedding API returned no vector.");
    }

    return NextResponse.json({
      dimensions: embedding.length,
      embedding,
    });
  } catch (error) {
    console.error("Embedding generation failed:", error);

    return NextResponse.json(
      { error: "Could not generate the question embedding." },
      { status: 500 }
    );
  }
}
