
import { Client, Account } from "appwrite";
import {
  Client as NodeClient,
  TablesDB as NodeTablesDB,
  Query,
  ID,
} from "node-appwrite";
import { NextRequest, NextResponse } from "next/server";

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!;
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!;
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;

const votesTableId = process.env.NEXT_PUBLIC_APPWRITE_VOTES_TABLE_ID!;
const clustersTableId = process.env.NEXT_PUBLIC_APPWRITE_CLUSTERS_TABLE_ID!;
const eventsTableId = process.env.NEXT_PUBLIC_APPWRITE_EVENTS_TABLE_ID!;

const TOTAL_CREDITS = 3;

function getAdminClient() {
  return new NodeClient()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(process.env.APPWRITE_API_KEY!);
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate participant
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
    const { clusterId, credits } = body;

    if (typeof clusterId !== "string" || !clusterId.trim()) {
      return NextResponse.json(
        { error: "A valid cluster ID is required." },
        { status: 400 }
      );
    }

    if (!Number.isInteger(credits) || credits < 0 || credits > 1) {
      return NextResponse.json(
        { success: false, message: "Credits must be 0 or 1 per cluster." },
        { status: 400 }
      );
    }

    const admin = new NodeTablesDB(getAdminClient());

    // 3. Fetch cluster and event
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

    if (event.status !== "live") {
      return NextResponse.json(
        { error: "This event has ended." },
        { status: 403 }
      );
    }

    if (event.votingStatus !== "open") {
      return NextResponse.json(
        { error: "Voting is currently not open." },
        { status: 403 }
      );
    }

    if (cluster.status !== "open") {
      return NextResponse.json(
        { error: "This question is no longer accepting votes." },
        { status: 409 }
      );
    }

    // 4. Find this participant's existing allocation for this cluster
    const currentVoteResult = await admin.listRows({
      databaseId,
      tableId: votesTableId,
      queries: [
        Query.equal("clusterId", clusterId),
        Query.equal("voterId", user.$id),
        Query.limit(1),
      ],
    });

    const currentVote = currentVoteResult.rows[0] as
      | { $id: string; credits?: number }
      | undefined;

    const currentCredits = currentVote?.credits ?? 0;

    // 5. Get all this participant's allocations in this event
    const allVotesResult = await admin.listRows({
      databaseId,
      tableId: votesTableId,
      queries: [
        Query.equal("eventId", event.$id),
        Query.equal("voterId", user.$id),
        Query.limit(100),
      ],
    });

    const voteRows = allVotesResult.rows as unknown as Array<{
      $id: string;
      clusterId: string;
      credits?: number;
    }>;

    // 6. Separate locked allocations from open allocations
    let lockedCredits = 0;
    let otherOpenCredits = 0;

    for (const vote of voteRows) {
      const voteCredits = vote.credits ?? 1;

      if (vote.clusterId === clusterId) continue;

      const otherCluster = await admin.getRow({
        databaseId,
        tableId: clustersTableId,
        rowId: vote.clusterId,
      });

      if (otherCluster.status === "open") {
        otherOpenCredits += voteCredits;
      } else {
        // Credits on answering/answered clusters are consumed.
        lockedCredits += voteCredits;
      }
    }

    const totalAfterAllocation =
      lockedCredits + otherOpenCredits + credits;

    if (totalAfterAllocation > TOTAL_CREDITS) {
      const available =
        TOTAL_CREDITS - lockedCredits - otherOpenCredits;

      return NextResponse.json(
        {
          error: `You have only ${available} credit(s) available.`,
          availableCredits: available,
        },
        { status: 409 }
      );
    }

    // 7. Save allocation (0 removes the vote)
    if (credits === 0) {
      if (currentVote) {
        await admin.deleteRow({
          databaseId,
          tableId: votesTableId,
          rowId: currentVote.$id,
        });
      }
    } else if (currentVote) {
      await admin.updateRow({
        databaseId,
        tableId: votesTableId,
        rowId: currentVote.$id,
        data: { credits, eventId: event.$id },
      });
    } else {
      await admin.createRow({
        databaseId,
        tableId: votesTableId,
        rowId: ID.unique(),
        data: {
          clusterId,
          voterId: user.$id,
          eventId: event.$id,
          credits,
        },
      });
    }

    // 8. Recalculate this cluster's vote count and credit score
    const clusterVotes = await admin.listRows({
      databaseId,
      tableId: votesTableId,
      queries: [
        Query.equal("clusterId", clusterId),
        Query.limit(100),
      ],
    });

    const newScore = clusterVotes.rows.reduce(
      (sum, row) => sum + ((row as { credits?: number }).credits ?? 1),
      0
    );

    // Number of participants who currently have a vote on this cluster
    const newVoteCount = clusterVotes.rows.length;

    await admin.updateRow({
      databaseId,
      tableId: clustersTableId,
      rowId: clusterId,
      data: {
        score: newScore,
        voteCount: newVoteCount,
      },
    });

    const remainingCredits =
      TOTAL_CREDITS - lockedCredits - otherOpenCredits - credits;

    return NextResponse.json({
      success: true,
      message: credits === 0
        ? "Allocation removed."
        : "Credits allocated successfully.",
      allocatedCredits: credits,
      remainingCredits,
      score: newScore,
    });
  } catch (error) {
    console.error("Voting API error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Something went wrong while voting.",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate participant
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

    // 2. Get eventId from query string
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get("eventId");

    if (!eventId) {
      return NextResponse.json(
        { error: "Event ID is required." },
        { status: 400 }
      );
    }

    const admin = new NodeTablesDB(getAdminClient());

    const event = await admin.getRow({
      databaseId,
      tableId: eventsTableId,
      rowId: eventId,
    });

    // 3. Load this participant's votes for this event
    const result = await admin.listRows({
      databaseId,
      tableId: votesTableId,
      queries: [
        Query.equal("eventId", eventId),
        Query.equal("voterId", user.$id),
        Query.limit(100),
      ],
    });

    const voteRows = result.rows as unknown as Array<{
      $id: string;
      clusterId: string;
      credits?: number;
    }>;

    // 4. Separate editable votes from locked votes
    const allocations: Record<string, number> = {};
    let lockedCredits = 0;
    let editableCredits = 0;

    for (const vote of voteRows) {
      const credits = vote.credits ?? 1;

      const cluster = await admin.getRow({
        databaseId,
        tableId: clustersTableId,
        rowId: vote.clusterId,
      });

      if (cluster.status === "open") {
        allocations[vote.clusterId] = credits;
        editableCredits += credits;
      } else {
        lockedCredits += credits;
      }
    }

    return NextResponse.json({
      success: true,
      eventId,
      allocations,
      lockedCredits,
      editableCredits,
      remainingCredits: TOTAL_CREDITS - lockedCredits - editableCredits,
      votingStatus: event.votingStatus,
      eventStatus: event.status,
    });
  } catch (error) {
    console.error("Get votes API error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load vote allocations.",
      },
      { status: 500 }
    );
  }
}