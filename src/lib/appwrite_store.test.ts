
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listRows,
  createRow,
  getRow,
  updateRow,
  incrementRowColumn,
  createTransaction,
  updateTransaction,
} = vi.hoisted(() => ({
  listRows: vi.fn(),
  createRow: vi.fn(),
  getRow: vi.fn(),
  updateRow: vi.fn(),
  incrementRowColumn: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
}));

vi.mock("node-appwrite", () => ({
  Client: class {
    setEndpoint() { return this; }
    setProject() { return this; }
    setKey() { return this; }
  },

  TablesDB: class {
    listRows = listRows;
    createRow = createRow;
    getRow = getRow;
    updateRow = updateRow;
    incrementRowColumn = incrementRowColumn;
    createTransaction = createTransaction;
    updateTransaction = updateTransaction;
  },

  ID: {
    unique: vi.fn(() => "generated-id"),
  },

  Query: {
    equal: vi.fn(() => "event-filter"),
    limit: vi.fn(() => "limit-100"),
    cursorAfter: vi.fn(() => "cursor"),
  },
}));

import { AppwriteStore } from "./appwrite_store";

describe("AppwriteStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubEnv(
      "NEXT_PUBLIC_APPWRITE_ENDPOINT",
      "https://cloud.appwrite.io/v1"
    );
    vi.stubEnv("NEXT_PUBLIC_APPWRITE_PROJECT_ID", "test-project");
    vi.stubEnv("APPWRITE_API_KEY", "test-api-key");

    vi.stubEnv("NEXT_PUBLIC_APPWRITE_DATABASE_ID", "test-db");
    vi.stubEnv("NEXT_PUBLIC_APPWRITE_CLUSTERS_TABLE_ID", "clusters");
    vi.stubEnv("NEXT_PUBLIC_APPWRITE_QUESTIONS_TABLE_ID", "questions");
    vi.stubEnv("NEXT_PUBLIC_APPWRITE_EMBEDDINGS_TABLE_ID", "embeddings");

    vi.stubEnv("GEMINI_EMBEDDING_MODEL", "test-embedding-model");

    createRow.mockResolvedValue({});
    updateRow.mockResolvedValue({});
    getRow.mockResolvedValue({
      $id: "cluster-1",
      eventId: "event-1",
      askCount: 2,
    });
    createTransaction.mockResolvedValue({
      $id: "transaction-1",
    });
    updateTransaction.mockResolvedValue({});
  });

  it("throws when Appwrite configuration is missing", () => {
    vi.stubEnv("APPWRITE_API_KEY", "");

    expect(() => new AppwriteStore()).toThrow(
      "Missing Appwrite server configuration."
    );
  });

  it("retrieves canonical questions with their embeddings", async () => {
    listRows.mockImplementation(async ({ tableId }) => {
      if (tableId === "clusters") {
        return {
          rows: [
            {
              $id: "cluster-1",
              title: "When is the exam?",
              canonicalQuestionId: "question-1",
            },
            {
              $id: "cluster-2",
              title: "When is Assignment 3 due?",
              canonicalQuestionId: "question-2",
            },
          ],
        };
      }

      return {
        rows: [
          {
            questionId: "question-1",
            vectorJson: JSON.stringify([1, 0]),
          },
          {
            questionId: "question-2",
            vectorJson: JSON.stringify([0, 1]),
          },
        ],
      };
    });

    const store = new AppwriteStore();

    const result = await store.getCanonicals("event-1");

    expect(result).toEqual([
      {
        clusterId: "cluster-1",
        text: "When is the exam?",
        vector: [1, 0],
      },
      {
        clusterId: "cluster-2",
        text: "When is Assignment 3 due?",
        vector: [0, 1],
      },
    ]);

    expect(listRows).toHaveBeenCalledTimes(2);
  });

  it("ignores clusters with missing or invalid canonical embeddings", async () => {
    listRows.mockImplementation(async ({ tableId }) => {
      if (tableId === "clusters") {
        return {
          rows: [
            {
              $id: "cluster-1",
              title: "Valid question",
              canonicalQuestionId: "question-1",
            },
            {
              $id: "cluster-2",
              title: "Missing embedding",
              canonicalQuestionId: "question-2",
            },
            {
              $id: "cluster-3",
              title: "Invalid embedding",
              canonicalQuestionId: "question-3",
            },
          ],
        };
      }

      return {
        rows: [
          {
            questionId: "question-1",
            vectorJson: "[1,0]",
          },
          {
            questionId: "question-3",
            vectorJson: "invalid-json",
          },
        ],
      };
    });

    const store = new AppwriteStore();

    const result = await store.getCanonicals("event-1");

    expect(result).toHaveLength(1);
    expect(result[0].clusterId).toBe("cluster-1");
  });

  it("creates a cluster, saves its question and embedding", async () => {
    const store = new AppwriteStore();

    const metadata = {
      questionId: "question-1",
      authorId: "user-1",
      requestId: "request-1",
      similarity: 1,
    };

    const clusterId = await store.createCluster(
      "event-1",
      "When is the exam?",
      [1, 0],
      metadata
    );

    expect(clusterId).toBe("generated-id");

    expect(createRow).toHaveBeenCalledTimes(3);

    expect(createRow).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tableId: "clusters",
        rowId: "generated-id",
        data: expect.objectContaining({
          eventId: "event-1",
          title: "When is the exam?",
          canonicalQuestionId: "question-1",
          askCount: 1,
          status: "open",
        }),
      })
    );

    expect(createRow).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        tableId: "questions",
        rowId: "question-1",
        data: expect.objectContaining({
          eventId: "event-1",
          clusterId: clusterId,
          text: "When is the exam?",
          authorId: "user-1",
          requestId: "request-1",
          similarity: 1,
        }),
      })
    );

    expect(createRow).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        tableId: "embeddings",
        data: expect.objectContaining({
          eventId: "event-1",
          questionId: "question-1",
          clusterId,
          vectorJson: "[1,0]",
          model: "test-embedding-model",
        }),
      })
    );
  });

  it("creates the question and cluster without an embedding when vector is empty", async () => {
    const store = new AppwriteStore();

    await store.createCluster(
      "event-1",
      "Question without embedding",
      [],
      {
        questionId: "question-1",
        authorId: "user-1",
        requestId: "request-1",
        similarity: 1,
      }
    );

    expect(createRow).toHaveBeenCalledTimes(2);

    expect(createRow).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: "clusters",
      })
    );

    expect(createRow).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: "questions",
      })
    );
  });

  it("adds a question, saves its embedding and increments askCount", async () => {
    const store = new AppwriteStore();

    await store.addToCluster(
      "cluster-1",
      "What is the exam date?",
      [0.9, 0.1],
      {
        questionId: "question-2",
        authorId: "user-2",
        requestId: "request-2",
        similarity: 0.95,
      }
    );

    expect(getRow).toHaveBeenCalledWith({
      databaseId: "test-db",
      tableId: "clusters",
      rowId: "cluster-1",
    });

    expect(createRow).toHaveBeenCalledTimes(2);

    expect(createRow).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: "questions",
        rowId: "question-2",
        data: expect.objectContaining({
          eventId: "event-1",
          clusterId: "cluster-1",
          text: "What is the exam date?",
          similarity: 0.95,
        }),
      })
    );

    expect(createRow).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: "embeddings",
        data: expect.objectContaining({
          questionId: "question-2",
          clusterId: "cluster-1",
          vectorJson: "[0.9,0.1]",
        }),
      })
    );

    expect(incrementRowColumn).toHaveBeenCalledWith(
        expect.objectContaining({
            databaseId: "test-db",
            tableId: "clusters",
            rowId: "cluster-1",
            column: "askCount",
            value: 1,
        })
    );
    });
});
