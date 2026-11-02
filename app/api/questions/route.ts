
import { Client, Account, TablesDB, ID, Query } from "appwrite";
import { Client as NodeClient, TablesDB as NodeTablesDB } from "node-appwrite";
import { NextRequest, NextResponse } from "next/server";
import { findBestMatch } from "@/lib/question_matching";

const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const eventsTableId = process.env.NEXT_PUBLIC_APPWRITE_EVENTS_TABLE_ID!;
const questionsTableId = process.env.NEXT_PUBLIC_APPWRITE_QUESTIONS_TABLE_ID!;
const clustersTableId = process.env.NEXT_PUBLIC_APPWRITE_CLUSTERS_TABLE_ID!;
const embeddingsTableId = process.env.NEXT_PUBLIC_APPWRITE_EMBEDDINGS_TABLE_ID!;

function getAdminClient() {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;

  if (!endpoint || !projectId || !apiKey) {
    throw new Error("Missing server-side Appwrite configuration.");
  }

  return new NodeClient()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey);
}

async function generateEmbedding(text: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing Gemini API key.");

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const result = await ai.models.embedContent({
    model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
    contents: text,
  });

  const vector = result.embeddings?.[0]?.values;
  if (!vector?.length) throw new Error("Embedding generation failed.");

  return vector;
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const jwt = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!jwt) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    // Verify the attendee's JWT using a user-scoped client.
    const userClient = new Client()
      .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
      .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
      .setJWT(jwt);

    const user = await new Account(userClient).get();

    const body = await request.json();
    const eventId =
      typeof body.eventId === "string" ? body.eventId.trim() : "";
    const text =
      typeof body.text === "string" ? body.text.trim() : "";

    if (!eventId || !text || text.length > 1000) {
      return NextResponse.json(
        { error: "Provide an event ID and a question of 1–1000 characters." },
        { status: 400 }
      );
    }

    const admin = new NodeTablesDB(getAdminClient());

    // Only accept questions for a live event.
    const event = await admin.getRow({
      databaseId,
      tableId: eventsTableId,
      rowId: eventId,
    });

    if (event.status !== "live") {
      return NextResponse.json(
        { error: "This event is not live." },
        { status: 400 }
      );
    }

    const vector = await generateEmbedding(text);

    // Compare only against embeddings from this event.
    const existing = await admin.listRows({
      databaseId,
      tableId: embeddingsTableId,
      queries: [Query.equal("eventId", eventId), Query.limit(100)],
    });

    const candidates = existing.rows.flatMap((row) => {
      try {
        const parsed = JSON.parse(String(row.vectorJson));
        if (
          !Array.isArray(parsed) ||
          !parsed.every((n) => typeof n === "number")
        ) return [];

        return [{
          questionId: String(row.questionId),
          clusterId: String(row.clusterId),
          vector: parsed as number[],
        }];
      } catch {
        return [];
      }
    });

    const threshold = Number(
      process.env.ASKONCE_SIMILARITY_THRESHOLD || "0.85"
    );

    const match = findBestMatch(vector, candidates, threshold);
    const requestId = ID.unique();

    let clusterId: string;
    let questionId: string;
    let similarity = 1;

    if (match) {
      clusterId = match.clusterId;
      similarity = match.similarity;

      // Create the question first, linked to the existing cluster.
      questionId = ID.unique();

      await admin.createRow({
        databaseId,
        tableId: questionsTableId,
        rowId: questionId,
        data: {
          eventId,
          clusterId,
          text,
          authorId: user.$id,
          requestId,
          similarity,
          flags: "[]",
          createdAt: new Date().toISOString(),
        },
      });

      const cluster = await admin.getRow({
        databaseId,
        tableId: clustersTableId,
        rowId: clusterId,
      });

      await admin.updateRow({
        databaseId,
        tableId: clustersTableId,
        rowId: clusterId,
        data: {
          askCount: Number(cluster.askCount || 0) + 1,
        },
      });
    } else {
      // Create a new cluster, then its canonical question.
      clusterId = ID.unique();
      questionId = ID.unique();

      await admin.createRow({
        databaseId,
        tableId: clustersTableId,
        rowId: clusterId,
        data: {
          eventId,
          title: text,
          canonicalQuestionId: questionId,
          askCount: 1,
          voteCount: 0,
          score: 0,
          status: "open",
          answerText: "",
        },
      });

      await admin.createRow({
        databaseId,
        tableId: questionsTableId,
        rowId: questionId,
        data: {
          eventId,
          clusterId,
          text,
          authorId: user.$id,
          requestId,
          similarity: 1,
          flags: "[]",
          createdAt: new Date().toISOString(),
        },
      });
    }

    // Save the embedding after the question and cluster exist.
    await admin.createRow({
      databaseId,
      tableId: embeddingsTableId,
      rowId: ID.unique(),
      data: {
        eventId,
        questionId,
        clusterId,
        vectorJson: JSON.stringify(vector),
        model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
      },
    });

    return NextResponse.json({
      success: true,
      questionId,
      clusterId,
      matchedExistingCluster: Boolean(match),
      similarity,
    });
  } catch (error) {
    console.error("Question submission failed:", error);

    return NextResponse.json(
      { error: "Question submission failed. Check the server logs." },
      { status: 500 }
    );
  }
}
