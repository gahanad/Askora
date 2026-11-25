import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockAccountGet,
  mockGetRow,
  mockRedisGet,
  mockRedisSet,
  mockRedisEval,
} = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT =
    "https://test.appwrite.io/v1";
  process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID = "test-project";
  process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID = "test-database";
  process.env.NEXT_PUBLIC_APPWRITE_EVENTS_TABLE_ID = "events";
  process.env.NEXT_PUBLIC_APPWRITE_CLUSTERS_TABLE_ID = "clusters";
  process.env.APPWRITE_API_KEY = "test-api-key";

  return {
    mockAccountGet: vi.fn(),
    mockGetRow: vi.fn(),
    mockRedisGet: vi.fn(),
    mockRedisSet: vi.fn(),
    mockRedisEval: vi.fn(),
  };
});

vi.mock("appwrite", () => {
  class MockClient {
    setEndpoint() {
      return this;
    }

    setProject() {
      return this;
    }

    setJWT() {
      return this;
    }
  }

  class MockAccount {
    get = mockAccountGet;

    constructor() {}
  }

  return {
    Client: MockClient,
    Account: MockAccount,
    ID: {
      unique: vi.fn(() => "mock-request-id"),
    },
  };
});

vi.mock("node-appwrite", () => {
  class MockClient {
    setEndpoint() { return this; }
    setProject() { return this; }
    setKey() { return this; }
  }

  class MockTablesDB {
    getRow = mockGetRow;
    constructor() {}
  }

  return {
    Client: MockClient,
    TablesDB: MockTablesDB,
  };
});

// Prevent external Redis connections during tests.
vi.mock("@/lib/redis", () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    eval: mockRedisEval,
  },
}));


import { POST } from "./route";

describe("POST /api/questions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when authorization header is missing", async () => {
    const request = new NextRequest(
      "http://localhost/api/questions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventId: "event-1",
          text: "When is the exam?",
        }),
      }
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Authentication required.");
    expect(mockAccountGet).not.toHaveBeenCalled();
  });

  it("returns 401 when JWT is invalid or expired", async () => {
    mockAccountGet.mockRejectedValue({
      code: 401,
      message: "Invalid token",
    });

    const request = new NextRequest(
      "http://localhost/api/questions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer invalid-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventId: "event-1",
          text: "When is the exam?",
        }),
      }
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe(
      "Invalid or expired authentication token."
    );
    expect(mockAccountGet).toHaveBeenCalledTimes(1);
  });


  it("returns 400 when request body contains malformed JSON", async () => {
    mockAccountGet.mockResolvedValue({ $id: "user-1" });

    const request = new NextRequest(
      "http://localhost/api/questions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
        },
        body: "{ invalid json",
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it("returns 400 when request body is not an object", async () => {
    mockAccountGet.mockResolvedValue({ $id: "user-1" });

    const request = new NextRequest(
      "http://localhost/api/questions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(["question"]),
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it("returns 400 when Idempotency-Key header is missing", async () => {
    mockAccountGet.mockResolvedValue({ $id: "user-1" });

    const request = new NextRequest(
      "http://localhost/api/questions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventId: "event-1",
          text: "When is the exam?",
        }),
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it("returns 400 when Idempotency-Key is not a valid UUID", async () => {
    mockAccountGet.mockResolvedValue({ $id: "user-1" });

    const request = new NextRequest(
      "http://localhost/api/questions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
          "Idempotency-Key": "invalid-id",
        },
        body: JSON.stringify({
          eventId: "event-1",
          text: "When is the exam?",
        }),
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(400);
  });


  it("returns 400 when eventId is missing", async () => {
    mockAccountGet.mockResolvedValue({ $id: "user-1" });

    const request = new NextRequest(
      "http://localhost/api/questions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
          "Idempotency-Key": "123e4567-e89b-42d3-a456-426614174000",
        },
        body: JSON.stringify({
          text: "When is the exam?",
        }),
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it("returns 400 when question text is empty", async () => {
    mockAccountGet.mockResolvedValue({ $id: "user-1" });

    const request = new NextRequest(
      "http://localhost/api/questions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
          "Idempotency-Key": "123e4567-e89b-42d3-a456-426614174000",
        },
        body: JSON.stringify({
          eventId: "event-1",
          text: "   ",
        }),
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it("returns 400 when question exceeds 1000 characters", async () => {
    mockAccountGet.mockResolvedValue({ $id: "user-1" });

    const request = new NextRequest(
      "http://localhost/api/questions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
          "Idempotency-Key": "123e4567-e89b-42d3-a456-426614174000",
        },
        body: JSON.stringify({
          eventId: "event-1",
          text: "a".repeat(1001),
        }),
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(400);
  });


  it("returns 400 when eventId is not a string", async () => {
    mockAccountGet.mockResolvedValue({ $id: "user-1" });

    const request = new NextRequest(
      "http://localhost/api/questions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
          "Idempotency-Key": "123e4567-e89b-42d3-a456-426614174000",
        },
        body: JSON.stringify({
          eventId: 123,
          text: "When is the exam?",
        }),
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it("returns 400 when question text is not a string", async () => {
    mockAccountGet.mockResolvedValue({ $id: "user-1" });

    const request = new NextRequest(
      "http://localhost/api/questions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/json",
          "Idempotency-Key": "123e4567-e89b-42d3-a456-426614174000",
        },
        body: JSON.stringify({
          eventId: "event-1",
          text: 12345,
        }),
      }
    );

    const response = await POST(request);
    expect(response.status).toBe(400);
  });


    it("returns 409 when an idempotency key is reused with different question text", async () => {
    mockAccountGet.mockResolvedValue({ $id: "user-1" });
    mockGetRow.mockResolvedValue({ status: "live" });

    // Fingerprint already exists.
    mockRedisSet.mockResolvedValue(null);
    mockRedisGet.mockResolvedValue("some-different-hash");

    const request = new NextRequest(
        "http://localhost/api/questions",
        {
        method: "POST",
        headers: {
            Authorization: "Bearer valid-token",
            "Content-Type": "application/json",
            "Idempotency-Key": "123e4567-e89b-42d3-a456-426614174000",
        },
        body: JSON.stringify({
            eventId: "event-1",
            text: "When is the exam?",
        }),
        }
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe(
        "This Idempotency-Key has already been used for a different question."
    );

    // Processing should stop before acquiring a lock.
    expect(mockRedisSet).toHaveBeenCalledTimes(1);
    });

    it("returns cached result for an already processed request", async () => {
    const cachedResult = {
        success: true,
        questionId: "question-1",
        clusterId: "cluster-1",
        matchedExistingCluster: false,
        similarity: 0,
        clusterStatus: "open",
        existingAnswer: "",
    };

    mockAccountGet.mockResolvedValue({ $id: "user-1" });
    mockGetRow.mockResolvedValue({ status: "live" });

    // First set: save fingerprint.
    mockRedisSet.mockResolvedValue("OK");

    // Return the already cached result.
    mockRedisGet.mockResolvedValue(cachedResult);

    const request = new NextRequest(
        "http://localhost/api/questions",
        {
        method: "POST",
        headers: {
            Authorization: "Bearer valid-token",
            "Content-Type": "application/json",
            "Idempotency-Key": "123e4567-e89b-42d3-a456-426614174000",
        },
        body: JSON.stringify({
            eventId: "event-1",
            text: "When is the exam?",
        }),
        }
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(cachedResult);

    // Only the fingerprint is written; no processing lock is acquired.
    expect(mockRedisSet).toHaveBeenCalledTimes(1);
    expect(mockRedisGet).toHaveBeenCalledTimes(1);
    });


});
