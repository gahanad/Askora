const BASE_URL = process.env.ASKORA_BASE_URL || "http://localhost:3000";
const JWT = process.env.ASKORA_TEST_JWT;
const EVENT_ID = process.env.ASKORA_TEST_EVENT_ID;

const CONCURRENT_REQUESTS = 25;

// Use a test event, not an event with real participants.
const question =
  "I will try my best for getting into company and get placed";

if (!JWT || !EVENT_ID) {
  throw new Error(
    "Set ASKORA_TEST_JWT and ASKORA_TEST_EVENT_ID first."
  );
}

async function submitQuestion(index) {
  const start = Date.now();

  try {
    const response = await fetch(
      `${BASE_URL}/api/questions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${JWT}`,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          eventId: EVENT_ID,
          text: question,
        }),
      }
    );

    const data = await response.json();

    return {
      index,
      status: response.status,
      success: data.success,
      clusterId: data.clusterId ?? null,
      matchedExistingCluster:
        data.matchedExistingCluster ?? null,
      durationMs: Date.now() - start,
      error: data.error ?? null,
    };
  } catch (error) {
    return {
      index,
      status: "NETWORK_ERROR",
      error: error.message,
    };
  }
}

async function runTest() {
  console.log(
    `Sending ${CONCURRENT_REQUESTS} simultaneous requests...`
  );

  const start = Date.now();

  const results = await Promise.all(
    Array.from(
      { length: CONCURRENT_REQUESTS },
      (_, index) => submitQuestion(index + 1)
    )
  );

  console.table(results);

  const successful = results.filter(
    (result) => result.success
  );

  const failed = results.filter(
    (result) => !result.success
  );

  const clusterIds = new Set(
    successful.map((result) => result.clusterId)
  );

  console.log("\n========== TEST SUMMARY ==========");
  console.log("Total requests:", CONCURRENT_REQUESTS);
  console.log("Successful:", successful.length);
  console.log("Failed:", failed.length);
  console.log("Unique clusters:", clusterIds.size);
  console.log("Total duration:", Date.now() - start, "ms");

  console.log(
    "Cluster IDs:",
    [...clusterIds]
  );

  if (
    successful.length === CONCURRENT_REQUESTS &&
    clusterIds.size === 1
  ) {
    console.log(
      "\nPASS: All submissions joined the same cluster."
    );
  } else {
    console.log(
      "\nCHECK: Some requests failed or created different clusters."
    );
  }
}

runTest();