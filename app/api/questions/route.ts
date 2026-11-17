
import { Client, Account, ID } from "appwrite";
import {
  Client as NodeClient,
  TablesDB as NodeTablesDB,
} from "node-appwrite";
import { NextRequest, NextResponse } from "next/server";

import { AppwriteStore } from "@/lib/appwrite_store";
import { assignQuestion } from "@/lib/assign";

const databaseId =
  process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;

const eventsTableId =
  process.env.NEXT_PUBLIC_APPWRITE_EVENTS_TABLE_ID!;

const clustersTableId =
  process.env.NEXT_PUBLIC_APPWRITE_CLUSTERS_TABLE_ID!;

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

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate the attendee.
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

    const userClient = new Client()
      .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
      .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
      .setJWT(jwt);

    const user = await new Account(userClient).get();

    // 2. Validate request data.
    const body = await request.json();

    const eventId =
      typeof body.eventId === "string"
        ? body.eventId.trim()
        : "";

    const text =
      typeof body.text === "string"
        ? body.text.trim()
        : "";

    if (!eventId || !text || text.length > 1000) {
      return NextResponse.json(
        {
          error:
            "Provide an event ID and a question of 1–1000 characters.",
        },
        { status: 400 }
      );
    }

    // 3. Verify that the event is live.
    const admin = new NodeTablesDB(getAdminClient());

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

    // 4. Generate identifiers and initialize the store.
    const questionId = ID.unique();
    const requestId = ID.unique();

    const store = new AppwriteStore();

    // 5. Run the semantic question assignment pipeline.
    const assignment = await assignQuestion(
      store,
      eventId,
      text,
      {
        questionId,
        authorId: user.$id,
        requestId,
      }
    );

    // 6. Retrieve the resulting cluster's current status and answer.
    let clusterStatus = "open";
    let existingAnswer = "";

    try {
      const cluster = await admin.getRow({
        databaseId,
        tableId: clustersTableId,
        rowId: assignment.clusterId,
      });

      clusterStatus = String(cluster.status || "open");
      existingAnswer = String(cluster.answerText || "");
    } catch (error) {
      // The question is already persisted.
      // Don't report submission failure because of a status lookup error.
      console.error("Could not retrieve cluster details:", error);
    }

    // 7. Preserve the existing frontend response structure.
    return NextResponse.json({
      success: true,
      questionId: assignment.questionId,
      clusterId: assignment.clusterId,
      matchedExistingCluster:
        assignment.decision === "JOINED",
      similarity: assignment.similarity,
      clusterStatus,
      existingAnswer,
    });

  } catch (error) {
    console.error("Question submission failed:", error);

    return NextResponse.json(
      {
        error:
          "Question submission failed. Check the server logs.",
      },
      { status: 500 }
    );
  }
}
