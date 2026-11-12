import { Client, Account } from "appwrite";
import {
  Client as NodeClient,
  TablesDB as NodeTablesDB,
} from "node-appwrite";
import { NextRequest, NextResponse } from "next/server";
import { Query } from "node-appwrite";

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!;
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!;
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;

const eventsTableId = process.env.NEXT_PUBLIC_APPWRITE_EVENTS_TABLE_ID!;
const clustersTableId = process.env.NEXT_PUBLIC_APPWRITE_CLUSTERS_TABLE_ID!;
const questionsTableId = process.env.NEXT_PUBLIC_APPWRITE_QUESTIONS_TABLE_ID!;

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

    // 2. Validate input
    const body = await request.json();
    const { questionId } = body;

    if (typeof questionId !== "string" || !questionId.trim()) {
      return NextResponse.json(
        { error: "A valid question ID is required." },
        { status: 400 }
      );
    }

    const admin = new NodeTablesDB(getAdminClient());

    // 3. Fetch question and its cluster
    const question = await admin.getRow({
      databaseId,
      tableId: questionsTableId,
      rowId: questionId,
    });

    const cluster = await admin.getRow({
      databaseId,
      tableId: clustersTableId,
      rowId: question.clusterId,
    });

    const event = await admin.getRow({
      databaseId,
      tableId: eventsTableId,
      rowId: cluster.eventId,
    });

    // 4. Verify host owns the event
    if (event.hostId !== user.$id) {
      return NextResponse.json(
        { error: "You are not authorized to moderate this question." },
        { status: 403 }
      );
    }

    if (event.status !== "live") {
      return NextResponse.json(
        { error: "This event is closed." },
        { status: 403 }
      );
    }

    // 5. If deleting the canonical question, find a replacement
    if (cluster.canonicalQuestionId === questionId) {
      const remainingQuestions = await admin.listRows({
        databaseId,
        tableId: questionsTableId,
        queries: [
          Query.equal("clusterId", cluster.$id),
          Query.limit(100),
        ],
      });

      const replacement = remainingQuestions.rows.find(
        (row) => row.$id !== questionId
      );

      if (replacement) {
        await admin.updateRow({
          databaseId,
          tableId: clustersTableId,
          rowId: cluster.$id,
          data: {
            canonicalQuestionId: replacement.$id,
            title: replacement.text,
          },
        });
      } else {
        return NextResponse.json(
          {
            error:
              "This is the cluster's only question. Remove the whole cluster using a separate moderation action.",
          },
          { status: 409 }
        );
      }
    }

    // 6. Delete only this submitted question
    await admin.deleteRow({
      databaseId,
      tableId: questionsTableId,
      rowId: questionId,
    });

    // 7. Update the cluster's question count
    await admin.updateRow({
      databaseId,
      tableId: clustersTableId,
      rowId: cluster.$id,
      data: {
        askCount: Math.max((cluster.askCount ?? 1) - 1, 0),
      },
    });

    return NextResponse.json({
      success: true,
      message: "Submitted question removed.",
    });
  } catch (error) {
    console.error("Question moderation API error:", error);

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