
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

type Action =
  | "start_voting"
  | "pause_voting"
  | "resume_voting"
  | "close_voting"
  | "close_event";

function getAdminClient() {
  return new NodeClient()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(process.env.APPWRITE_API_KEY!);
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate the host
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
    const { eventId, action } = body as {
      eventId?: string;
      action?: Action;
    };

    const validActions: Action[] = [
      "start_voting",
      "pause_voting",
      "resume_voting",
      "close_voting",
      "close_event",
    ];

    if (
      typeof eventId !== "string" ||
      !eventId.trim() ||
      !validActions.includes(action as Action)
    ) {
      return NextResponse.json(
        { error: "Valid eventId and action are required." },
        { status: 400 }
      );
    }

    // 3. Fetch event using server API key
    const admin = new NodeTablesDB(getAdminClient());

    const event = await admin.getRow({
      databaseId,
      tableId: eventsTableId,
      rowId: eventId,
    });

    // 4. Verify event ownership
    if (event.hostId !== user.$id) {
      return NextResponse.json(
        { error: "You are not authorized to manage this event." },
        { status: 403 }
      );
    }

    // 5. Check event state
    if (event.status !== "live") {
      return NextResponse.json(
        { error: "This event is already closed." },
        { status: 409 }
      );
    }

    // Old events may not have votingStatus yet.
    const currentVotingStatus =
      event.votingStatus || "not_started";

    let newVotingStatus = currentVotingStatus;
    let newEventStatus = event.status;

    // 6. Validate state transitions
    switch (action) {
      case "start_voting":
        if (currentVotingStatus !== "not_started") {
          return NextResponse.json(
            { error: "Voting has already been started." },
            { status: 409 }
          );
        }
        newVotingStatus = "open";
        break;

      case "pause_voting":
        if (currentVotingStatus !== "open") {
          return NextResponse.json(
            { error: "Only open voting can be paused." },
            { status: 409 }
          );
        }
        newVotingStatus = "paused";
        break;

      case "resume_voting":
        if (currentVotingStatus !== "paused") {
          return NextResponse.json(
            { error: "Only paused voting can be resumed." },
            { status: 409 }
          );
        }
        newVotingStatus = "open";
        break;

      case "close_voting":
        if (
          currentVotingStatus === "closed"
        ) {
          return NextResponse.json(
            { error: "Voting is already closed." },
            { status: 409 }
          );
        }
        newVotingStatus = "closed";
        break;

      case "close_event":
        newEventStatus = "closed";
        newVotingStatus = "closed";
        break;
    }

    // 7. Update event
    const updatedEvent = await admin.updateRow({
      databaseId,
      tableId: eventsTableId,
      rowId: eventId,
      data: {
        status: newEventStatus,
        votingStatus: newVotingStatus,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Event updated successfully.",
      event: {
        eventId: updatedEvent.$id,
        status: updatedEvent.status,
        votingStatus: updatedEvent.votingStatus,
      },
    });

  } catch (error) {
    console.error("Event control API error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not update event.",
      },
      { status: 500 }
    );
  }
}
