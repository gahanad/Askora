
export type CanonicalQuestion = {
  clusterId: string;
  text: string;
  vector: number[];
};

export interface ClusterStore {
  getCanonicals(eventId: string): Promise<CanonicalQuestion[]>;

  createCluster(
    eventId: string,
    text: string,
    vector: number[]
  ): Promise<string>;

  addToCluster(
    clusterId: string,
    text: string
  ): Promise<void>;
}

type StoredCluster = {
  eventId: string;
  clusterId: string;
  canonicalText: string;
  vector: number[];
  questions: string[];
};

export class InMemoryStore implements ClusterStore {
  private clusters = new Map<string, StoredCluster>();

  private nextId = 1;

  async getCanonicals(
    eventId: string
  ): Promise<CanonicalQuestion[]> {
    return Array.from(this.clusters.values())
      .filter((cluster) => cluster.eventId === eventId)
      .map((cluster) => ({
        clusterId: cluster.clusterId,
        text: cluster.canonicalText,
        vector: [...cluster.vector],
      }));
  }

  async createCluster(
    eventId: string,
    text: string,
    vector: number[]
  ): Promise<string> {
    const clusterId = `cluster-${this.nextId++}`;

    this.clusters.set(clusterId, {
      eventId,
      clusterId,
      canonicalText: text,
      vector: [...vector],
      questions: [text],
    });

    return clusterId;
  }

  async addToCluster(
    clusterId: string,
    text: string
  ): Promise<void> {
    const cluster = this.clusters.get(clusterId);

    if (!cluster) {
      throw new Error(`Cluster ${clusterId} does not exist.`);
    }

    cluster.questions.push(text);
  }
}
