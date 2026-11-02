
import { Client, Account } from "appwrite";
import {
  Client as NodeClient,
  TablesDB as NodeTablesDB,
} from "node-appwrite";
import { NextRequest, NextResponse } from "next/server";

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!;
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!;
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;

const eventsTableId = process.env.NEXT_PUBLIC_APPWRITE_EVENTS_TABLE_ID!;
const clustersTableId = process.env.NEXT_PUBLIC_APPWRITE_CLUSTERS_TABLE_ID!;

function getAdminClient() {
  return new NodeClient()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(process.env.APPWRITE_API_KEY!);
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate host
    const authHeader = request.headers.get("authorization");
    const jwt = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : null;

    if (!jwt) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    const userClient = new Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setJWT(jwt);

    const account = new Account(userClient);
    const user = await account.get();

    // 2. Validate request
    const body = await request.json();
    const { clusterId, action, answerText } = body;

    if (
      typeof clusterId !== "string" ||
      !clusterId.trim()
    ) {
      return NextResponse.json(
        { error: "A valid cluster ID is required." },
        { status: 400 }
      );
    }

    if (!["start_answering", "publish_answer"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action." },
        { status: 400 }
      );
    }

    const admin = new NodeTablesDB(getAdminClient());

    // 3. Fetch cluster and its event
    const cluster = await admin.getRow({
      databaseId,
      tableId: clustersTableId,
      rowId: clusterId,
    });

    const event = await admin.getRow({
      databaseId,
      tableId: eventsTableId,
      rowId: cluster.eventId,
    });

    // 4. Verify event ownership
    if (event.hostId !== user.$id) {
      return NextResponse.json(
        { error: "You are not authorized to manage this question." },
        { status: 403 }
      );
    }

    if (event.status !== "live") {
      return NextResponse.json(
        { error: "This event is closed." },
        { status: 403 }
      );
    }

    // 5. Start answering
    if (action === "start_answering") {
      if (cluster.status !== "open") {
        return NextResponse.json(
          { error: "Only open questions can be answered." },
          { status: 409 }
        );
      }

      await admin.updateRow({
        databaseId,
        tableId: clustersTableId,
        rowId: clusterId,
        data: {
          status: "answering",
        },
      });

      return NextResponse.json({
        success: true,
        message: "Question is now being answered.",
      });
    }

    // 6. Publish answer
    if (action === "publish_answer") {
      if (cluster.status !== "answering") {
        return NextResponse.json(
          { error: "Start answering this question first." },
          { status: 409 }
        );
      }

      if (
        typeof answerText !== "string" ||
        !answerText.trim()
      ) {
        return NextResponse.json(
          { error: "Please enter an answer before publishing." },
          { status: 400 }
        );
      }

      await admin.updateRow({
        databaseId,
        tableId: clustersTableId,
        rowId: clusterId,
        data: {
          answerText: answerText.trim(),
          status: "answered",
        },
      });

      return NextResponse.json({
        success: true,
        message: "Answer published successfully.",
      });
    }

  } catch (error) {
    console.error("Cluster answer API error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Something went wrong.",
      },
      { status: 500 }
    );
  }
}
