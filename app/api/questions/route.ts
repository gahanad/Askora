
import { Client, Account, ID } from "appwrite";
import { redis } from "@/lib/redis";
import {
  Client as NodeClient,
  TablesDB as NodeTablesDB,
} from "node-appwrite";
import { NextRequest, NextResponse } from "next/server";

import { AppwriteStore } from "@/lib/appwrite_store";
import { assignQuestion } from "@/lib/assign";
import { randomUUID, createHash } from "node:crypto";

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

const PROCESSING_TTL = 600; // 10 minutes
const RESULT_TTL = 86400;   // 24 hours

const RELEASE_IDEMPOTENCY_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

const RENEW_IDEMPOTENCY_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("EXPIRE", KEYS[1], tonumber(ARGV[2]))
  end
  return 0
`;

const IDEMPOTENCY_RENEW_INTERVAL = 60_000;

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const value = error as {
    code?: unknown;
    status?: unknown;
  };

  if (typeof value.code === "number") {
    return value.code;
  }

  if (typeof value.status === "number") {
    return value.status;
  }

  return undefined;
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

    let user;

    try {
      user = await new Account(userClient).get();
    } catch (error) {
      const status = getErrorStatus(error);

      if (status === 401 || status === 403) {
        return NextResponse.json(
          { error: "Invalid or expired authentication token." },
          { status: 401 }
        );
      }

      throw error;
    }

    // 2. Validate request data.
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        { error: "Request body must be a JSON object." },
        { status: 400 }
      );
    }

    const payload = body as {
      eventId?: unknown;
      text?: unknown;
    };

    const eventId =
      typeof payload.eventId === "string"
        ? payload.eventId.trim()
        : "";

    const text =
      typeof payload.text === "string"
        ? payload.text.trim()
        : "";
    const idempotencyKey = request.headers.get("Idempotency-Key");

    if (
      !idempotencyKey ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        idempotencyKey
      )
    ) {
      return NextResponse.json(
        { error: "A valid Idempotency-Key is required." },
        { status: 400 }
      );
    }

    if (!eventId || !text || text.length > 1000) {
      return NextResponse.json(
        {
          error: "Provide an event ID and a question of 1 to 1000 characters.",
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

    // 4. Generate idempotency keys.
    const identity = `${user.$id}:${eventId}:${idempotencyKey}`;

    const processingKey = `askora:idempotency:processing:${identity}`;
    const resultKey = `askora:idempotency:result:${identity}`;
    const fingerprintKey = `askora:idempotency:fingerprint:${identity}`;

    const payloadHash = createHash("sha256")
      .update(text)
      .digest("hex");

    // 5. Validate the payload fingerprint.
    const fingerprintStored = await redis.set(
      fingerprintKey,
      payloadHash,
      {
        nx: true,
        ex: RESULT_TTL,
      }
    );

    if (fingerprintStored !== "OK") {
      const existingFingerprint = await redis.get(fingerprintKey);

      if (existingFingerprint !== payloadHash) {
        return NextResponse.json(
          {
            error:
              "This Idempotency-Key has already been used for a different question.",
          },
          { status: 409 }
        );
      }
    }

    // 6. Return cached response if available.
    const cachedResult = await redis.get(resultKey);

    if (cachedResult) {
      return NextResponse.json(cachedResult);
    }

    // 7. Acquire processing lock.
    const processingToken = randomUUID();

    const acquired = await redis.set(
      processingKey,
      processingToken,
      {
        nx: true,
        ex: PROCESSING_TTL,
      }
    );

    if (acquired !== "OK") {
      const existingResult = await redis.get(resultKey);

      if (existingResult) {
        return NextResponse.json(existingResult);
      }

      return NextResponse.json(
        {
          error:
            "This question submission is already being processed. Please retry shortly.",
        },
        {
          status: 409,
          headers: { "Retry-After": "2" },
        }
      );
    }

    let stopIdempotencyHeartbeat = false;
    let idempotencyLockLost = false;
    let renewalPromise: Promise<void> | null = null;

    const idempotencyHeartbeat = setInterval(() => {
      if (renewalPromise || stopIdempotencyHeartbeat) {
        return;
      }

      renewalPromise = (async () => {
        try {
          const renewed = await redis.eval(
            RENEW_IDEMPOTENCY_SCRIPT,
            [processingKey],
            [processingToken, String(PROCESSING_TTL)]
          );

          if (Number(renewed) !== 1) {
            idempotencyLockLost = true;
            console.error("Idempotency lock ownership lost.");
          }
        } catch (error) {
          idempotencyLockLost = true;
          console.error("Idempotency lock renewal failed:", error);
        } finally {
          renewalPromise = null;
        }
      })();
    }, IDEMPOTENCY_RENEW_INTERVAL);
    // 8. Process question while owning the lock.
    try {
      const questionId = idempotencyKey.replaceAll("-", "");
      const requestId = ID.unique();

      const store = new AppwriteStore();

      // 8A. Check whether this submission was already persisted.
      const existingQuestion = await store.getQuestionById(questionId);

      if (existingQuestion) {
        // Prevent returning another user's or event's question.
        if (
          existingQuestion.eventId !== eventId ||
          existingQuestion.authorId !== user.$id ||
          existingQuestion.text !== text
        ) {
          return NextResponse.json(
            {
              error: "This submission ID is already associated with another question.",
            },
            { status: 409 }
          );
        }

        const existingClusterId = String(existingQuestion.clusterId);

        const existingCluster = await admin.getRow({
          databaseId,
          tableId: clustersTableId,
          rowId: existingClusterId,
        });

        const recoveredResponse = {
          success: true,
          questionId,
          clusterId: existingClusterId,
          matchedExistingCluster:
            String(existingCluster.canonicalQuestionId) !== questionId,
          similarity: Number(existingQuestion.similarity),
          clusterStatus: String(existingCluster.status || "open"),
          existingAnswer: String(existingCluster.answerText || ""),
        };

        // Verify lock ownership before caching the response.
        if (idempotencyLockLost) {
          throw new Error(
            "IDEMPOTENCY_LOCK_LOST: Submission lock ownership was lost."
          );
        }

        // Rebuild the Redis response cache.
        await redis.set(resultKey, recoveredResponse, {
          ex: RESULT_TTL,
        });
        return NextResponse.json(recoveredResponse);
      }

      // 8B. New submission: run the assignment pipeline.
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

      // 9. Retrieve cluster status and answer.
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
        console.error(
          "Could not retrieve cluster details:",
          error
        );
      }

      // 10. Prepare and cache response.
      const responseData = {
        success: true,
        questionId: assignment.questionId,
        clusterId: assignment.clusterId,
        matchedExistingCluster:
          assignment.decision === "JOINED",
        similarity: assignment.similarity,
        clusterStatus,
        existingAnswer,
      };

      // Verify idempotency lock ownership.
      if (idempotencyLockLost) {
        throw new Error(
          "IDEMPOTENCY_LOCK_LOST: Submission lock ownership was lost."
        );
      }

      await redis.set(resultKey, responseData, {
        ex: RESULT_TTL,
      });
      return NextResponse.json(responseData);

    } finally {
      // 11. Release lock only if this request still owns it.
      stopIdempotencyHeartbeat = true;
      clearInterval(idempotencyHeartbeat);

      if (renewalPromise) {
        await renewalPromise;
      }
      try {
        await redis.eval(
          RELEASE_IDEMPOTENCY_SCRIPT,
          [processingKey],
          [processingToken]
        );
      } catch (releaseError) {
        // Don't mask the original result or processing error.
        console.error(
          "Could not release idempotency lock:",
          releaseError
        );
      }
    }

  } catch (error) {
    console.error("Question submission failed:", error);

    if (error instanceof Error) {
      const isTemporaryFailure =
        error.message.startsWith("JUDGE_UNAVAILABLE:") ||
        error.message.startsWith("EMBEDDING_UNAVAILABLE:") ||
        error.message.startsWith("IDEMPOTENCY_LOCK_LOST:") ||
        error.message.includes(
          "Could not acquire distributed lock in time"
        );

      if (isTemporaryFailure) {
        return NextResponse.json(
          {
            error:
              "Askora is temporarily unable to process your question. Please retry shortly.",
            retryable: true,
          },
          {
            status: 503,
            headers: {
              "Retry-After": "5",
            },
          }
        );
      }
    }

    return NextResponse.json(
      {
        error:
          "Question submission failed. Check the server logs.",
      },
      { status: 500 }
    );
  }
}
