
import { Client, Account, TablesDB, ID, Query } from "appwrite";
import { Client as NodeClient, TablesDB as NodeTablesDB } from "node-appwrite";
import { NextRequest, NextResponse } from "next/server";
import { findTopMatches } from "@/lib/question_matching";

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

    const matches = findTopMatches(vector, candidates, threshold);
    const match = matches[0] ?? null;
    const requestId = ID.unique();

    let clusterId: string;
    let questionId: string;
    let similarity = 1;
    let clusterStatus = "open";
    let existingAnswer = "";

    if (match) {
      clusterId = match.clusterId;
      similarity = match.similarity;

      // Create the question first, linked to the existing cluster.
      questionId = ID.unique();
      const cluster = await admin.getRow({
        databaseId,
        tableId: clustersTableId,
        rowId: match.clusterId,
      });

      clusterStatus = String(cluster.status || "open");
      existingAnswer = String(cluster.answerText || "");

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
      clusterStatus,
      existingAnswer,
    });
  } catch (error) {
    console.error("Question submission failed:", error);

    return NextResponse.json(
      { error: "Question submission failed. Check the server logs." },
      { status: 500 }
    );
  }
}


type IntentVerificationResult = {
  sameIntent: boolean;
  candidateIndex: number;
};

async function verifyQuestionIntent(
  incomingQuestion: string,
  candidateQuestions: string[]
): Promise<IntentVerificationResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing Gemini API key.");
  }

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
You are an intent-matching assistant for a live Q&A platform.

Your task is to determine whether the incoming question has
the SAME answerable intent as one of the existing questions.

Rules:
1. Questions must require essentially the same answer.
2. Similar topics do NOT automatically mean the same intent.
3. Different dates, conditions, requirements, processes,
   or requested information usually mean different intents.
4. If none match, return sameIntent as false.
5. Select only one best candidate.

Incoming question:
${JSON.stringify(incomingQuestion)}

Existing candidate questions:
${JSON.stringify(candidateQuestions)}

Return ONLY valid JSON in this format:
{
  "sameIntent": true,
  "candidateIndex": 0
}

If none match:
{
  "sameIntent": false,
  "candidateIndex": -1
}
`;

  const result = await ai.models.generateContent({
    model: process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    },
  });

  const responseText = result.text;

  if (!responseText) {
    throw new Error("Gemini returned an empty verification response.");
  }

  const parsed = JSON.parse(responseText);

  if (
    typeof parsed.sameIntent !== "boolean" ||
    !Number.isInteger(parsed.candidateIndex) ||
    (parsed.sameIntent &&
      (parsed.candidateIndex < 0 ||
        parsed.candidateIndex >= candidateQuestions.length)) ||
    (!parsed.sameIntent && parsed.candidateIndex !== -1)
  ) {
    throw new Error("Gemini returned an invalid verification response.");
  }

  return parsed as IntentVerificationResult;
}
