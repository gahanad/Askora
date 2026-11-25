
import {
  Client,
  ID,
  Query,
  TablesDB,
} from "node-appwrite";

import type {
  CanonicalQuestion,
  ClusterStore,
  QuestionMetadata,
} from "./store";

type AppwriteRow = {
  $id: string;
  [key: string]: unknown;
};

export class AppwriteStore implements ClusterStore {
  private tablesDB: TablesDB;

  private databaseId: string;
  private clustersTableId: string;
  private questionsTableId: string;
  private embeddingsTableId: string;

  constructor() {
    const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
    const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
    const apiKey = process.env.APPWRITE_API_KEY;

    this.databaseId =
      process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || "";

    this.clustersTableId =
      process.env.NEXT_PUBLIC_APPWRITE_CLUSTERS_TABLE_ID || "";

    this.questionsTableId =
      process.env.NEXT_PUBLIC_APPWRITE_QUESTIONS_TABLE_ID || "";

    this.embeddingsTableId =
      process.env.NEXT_PUBLIC_APPWRITE_EMBEDDINGS_TABLE_ID || "";

    if (
      !endpoint ||
      !projectId ||
      !apiKey ||
      !this.databaseId ||
      !this.clustersTableId ||
      !this.questionsTableId ||
      !this.embeddingsTableId
    ) {
      throw new Error("Missing Appwrite server configuration.");
    }

    const client = new Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setKey(apiKey);

    this.tablesDB = new TablesDB(client);
  }

  private async runInTransaction<T>(
  operation: (transactionId: string) => Promise<T>
): Promise<T> {
  const transaction = await this.tablesDB.createTransaction({
    ttl: 60,
  });

  const transactionId = transaction.$id;

  try {
    const result = await operation(transactionId);

    await this.tablesDB.updateTransaction({
      transactionId,
      commit: true,
    });

    return result;
  } catch (error) {
    try {
      await this.tablesDB.updateTransaction({
        transactionId,
        rollback: true,
      });
    } catch (rollbackError) {
      console.error("Failed to roll back Appwrite transaction:", rollbackError);
    }

    throw error;
  }
} 

  private async listAllRows(
    tableId: string,
    eventId: string
  ): Promise<AppwriteRow[]> {
    const rows: AppwriteRow[] = [];
    let cursor: string | undefined;

    while (true) {
      const queries = [
        Query.equal("eventId", eventId),
        Query.limit(100),
      ];

      if (cursor) {
        queries.push(Query.cursorAfter(cursor));
      }

      const page = await this.tablesDB.listRows({
        databaseId: this.databaseId,
        tableId,
        queries,
      });

      const pageRows = page.rows as AppwriteRow[];

      rows.push(...pageRows);

      if (pageRows.length < 100) {
        break;
      }

      cursor = pageRows[pageRows.length - 1].$id;
    }

    return rows;
  }

  private async saveEmbedding(
  eventId: string,
  questionId: string,
  clusterId: string,
  vector: number[],
  transactionId?: string
): Promise<void> {
  if (vector.length === 0) {
    return;
  }

  await this.tablesDB.createRow({
    databaseId: this.databaseId,
    tableId: this.embeddingsTableId,
    rowId: ID.unique(),
    data: {
      eventId,
      questionId,
      clusterId,
      vectorJson: JSON.stringify(vector),
      model:
        process.env.GEMINI_EMBEDDING_MODEL ||
        "gemini-embedding-2",
    },
    transactionId,
  });
}

  private async saveQuestion(
  eventId: string,
  clusterId: string,
  text: string,
  metadata: QuestionMetadata,
  transactionId?: string
): Promise<void> {
  await this.tablesDB.createRow({
    databaseId: this.databaseId,
    tableId: this.questionsTableId,
    rowId: metadata.questionId,
    data: {
      eventId,
      clusterId,
      text,
      authorId: metadata.authorId,
      requestId: metadata.requestId,
      similarity: metadata.similarity,
      flags: "[]",
      createdAt: new Date().toISOString(),
    },
    transactionId,
  });
}

  async getQuestionById(
    questionId: string
  ): Promise<AppwriteRow | null> {
    try {
      const question = await this.tablesDB.getRow({
        databaseId: this.databaseId,
        tableId: this.questionsTableId,
        rowId: questionId,
      });

      return question as AppwriteRow;
    } catch (error) {
      const appwriteError = error as {
        code?: number;
        status?: number;
      };

      const status = appwriteError.code ?? appwriteError.status;

      if (status === 404) {
        return null;
      }

      throw error;
    }
  }

  async getCanonicals(
    eventId: string
  ): Promise<CanonicalQuestion[]> {
    const [clusters, embeddings] = await Promise.all([
      this.listAllRows(this.clustersTableId, eventId),
      this.listAllRows(this.embeddingsTableId, eventId),
    ]);

    const embeddingByQuestionId = new Map<
      string,
      number[]
    >();

    for (const row of embeddings) {
      try {
        const vector = JSON.parse(
          String(row.vectorJson)
        );

        if (
          Array.isArray(vector) &&
          vector.length > 0 &&
          vector.every(
            (value) =>
              typeof value === "number" &&
              Number.isFinite(value)
          )
        ) {
          embeddingByQuestionId.set(
            String(row.questionId),
            vector
          );
        }
      } catch {
        // Ignore malformed stored embeddings.
      }
    }

    const canonicals: CanonicalQuestion[] = [];

    for (const cluster of clusters) {
      const canonicalQuestionId = String(
        cluster.canonicalQuestionId || ""
      );

      const vector = embeddingByQuestionId.get(
        canonicalQuestionId
      );

      // Clusters without valid canonical embeddings
      // cannot participate in similarity retrieval.
      if (!vector) {
        continue;
      }

      canonicals.push({
        clusterId: cluster.$id,
        text: String(cluster.title || ""),
        vector,
      });
    }

    return canonicals;
  }

  async createCluster(
  eventId: string,
  text: string,
  vector: number[],
  metadata: QuestionMetadata
): Promise<string> {
  const clusterId = ID.unique();

  await this.runInTransaction(async (transactionId) => {
    await this.tablesDB.createRow({
      databaseId: this.databaseId,
      tableId: this.clustersTableId,
      rowId: clusterId,
      data: {
        eventId,
        title: text,
        canonicalQuestionId: metadata.questionId,
        askCount: 1,
        voteCount: 0,
        score: 0,
        status: "open",
        answerText: "",
      },
      transactionId,
    });

    await this.saveQuestion(
      eventId,
      clusterId,
      text,
      metadata,
      transactionId
    );

    await this.saveEmbedding(
      eventId,
      metadata.questionId,
      clusterId,
      vector,
      transactionId
    );
  });

  return clusterId;
}

  async addToCluster(
  clusterId: string,
  text: string,
  vector: number[],
  metadata: QuestionMetadata
): Promise<void> {
  const cluster = await this.tablesDB.getRow({
    databaseId: this.databaseId,
    tableId: this.clustersTableId,
    rowId: clusterId,
  });

  const eventId = String(cluster.eventId);

  await this.runInTransaction(async (transactionId) => {
    await this.saveQuestion(
      eventId,
      clusterId,
      text,
      metadata,
      transactionId
    );

    await this.saveEmbedding(
      eventId,
      metadata.questionId,
      clusterId,
      vector,
      transactionId
    );

    await this.tablesDB.incrementRowColumn({
      databaseId: this.databaseId,
      tableId: this.clustersTableId,
      rowId: clusterId,
      column: "askCount",
      value: 1,
      transactionId,
    });
  });
}
}
