
"use client";

import { useEffect, useState, Suspense, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { account, tablesDB, getAppwriteJWT, client} from "@/lib/appwrite";
import { AppwriteException, Query } from "appwrite";

const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const eventsTableId = process.env.NEXT_PUBLIC_APPWRITE_EVENTS_TABLE_ID!;
const clustersTableId = process.env.NEXT_PUBLIC_APPWRITE_CLUSTERS_TABLE_ID!;
const questionsTableId = process.env.NEXT_PUBLIC_APPWRITE_QUESTIONS_TABLE_ID!;
const votesTableId = process.env.NEXT_PUBLIC_APPWRITE_VOTES_TABLE_ID!;

type Event = {
  $id: string;
  hostId: string;
  title: string;
  joinCode: string;
  status: string;
  votingStatus: string;
};

type Cluster = {
  $id: string;
  eventId: string;
  title: string;
  askCount: number;
  voteCount: number;
  score: number;
  status: string;
  answerText?: string;
};

type Question = {
  $id: string;
  eventId: string;
  clusterId: string;
  text: string;
  authorId?: string;
  createdAt?: string;
};

type EventAction =
  | "start_voting"
  | "pause_voting"
  | "resume_voting"
  | "close_voting"
  | "close_event";

function HostEventContent() {
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;

  const [event, setEvent] = useState<Event | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [answerLoadingId, setAnswerLoadingId] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);

  const clustersRef = useRef<Cluster[]>([]);
  clustersRef.current = clusters;

  async function loadEventData() {
    setLoading(true);
    setError("");

    try {
      const user = await account.get();

      const eventResult = await tablesDB.getRow({
        databaseId,
        tableId: eventsTableId,
        rowId: eventId,
      });

      const eventData = eventResult as unknown as Event;

      if (eventData.hostId !== user.$id) {
        throw new Error("You are not authorized to manage this event.");
      }

      setEvent(eventData);
      const clusterResult = await tablesDB.listRows({
        databaseId,
        tableId: clustersTableId,
        queries: [
          Query.equal("eventId", eventId),
          Query.limit(100),
        ],
      });

      const rows = clusterResult.rows as unknown as Cluster[];

      rows.sort(
        (a, b) =>
          (b.voteCount ?? 0) - (a.voteCount ?? 0) ||
          (b.askCount ?? 0) - (a.askCount ?? 0)
      );

      setClusters(rows);
      // Fetch ALL questions using pagination
      let loadedQuestions: Question[] = [];
      let offset = 0;
      const batchSize = 100;

      while (true) {
        const questionResult = await tablesDB.listRows({
          databaseId,
          tableId: questionsTableId,
          queries: [
            Query.equal("eventId", eventId),
            Query.limit(batchSize),
            Query.offset(offset),
          ],
        });

        const fetchedRows = questionResult.rows as unknown as Question[];

        loadedQuestions = [...loadedQuestions, ...fetchedRows];

        if (fetchedRows.length < batchSize) {
          break;
        }

        offset += batchSize;
      }
      setQuestions(loadedQuestions);
      const clusterIds = new Set(rows.map((c) => c.$id));

    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load event details."
      );
    } finally {
      setLoading(false);
    }
  }

  async function controlEvent(action: EventAction) {
    setActionLoading(true);
    setError("");

    try {
      const jwt = await getAppwriteJWT();

      const response = await fetch("/api/events/control", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventId,
          action,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not update event.");
      }

      await loadEventData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setActionLoading(false);
    }
  }
  async function manageClusterAnswer(
    clusterId: string,
    action: "start_answering" | "publish_answer"
    ) {
    setAnswerLoadingId(clusterId);
    setError("");

    try {
        const jwt = await getAppwriteJWT();

        const response = await fetch("/api/clusters/answer", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            clusterId,
            action,
            answerText: answerDrafts[clusterId],
        }),
        });

        const result = await response.json();

        if (!response.ok) {
        throw new Error(result.error || "Could not update question.");
        }

        await loadEventData();

    } catch (err) {
        setError(
        err instanceof Error
            ? err.message
            : "Something went wrong."
        );
    } finally {
        setAnswerLoadingId("");
    }
  }

  useEffect(() => {
    if (eventId) {
      void loadEventData();
    }
  }, [eventId]);
useEffect(() => {
  if (!eventId || !event) return;
  const unsubscribe = client.subscribe(
    [
      `databases.${databaseId}.tables.${clustersTableId}.rows`,
      `databases.${databaseId}.tables.${questionsTableId}.rows`,
    ],
    (response) => {
      const payload = response.payload as Partial<Cluster> & {
        eventId?: string;
      };

      if (payload.eventId !== eventId) return;

      const existingCluster = clustersRef.current.find(
        (cluster) => cluster.$id === payload.$id
      );

      // New cluster: refresh the dashboard.
      if (!existingCluster) {
        void loadEventData();
        return;
      }

      // Ignore vote-count-only changes.
      // Refresh for changes that matter to the host.
      const importantChange =
        existingCluster.title !== payload.title ||
        existingCluster.askCount !== payload.askCount ||
        existingCluster.status !== payload.status ||
        existingCluster.answerText !== payload.answerText;

      if (importantChange) {
        void loadEventData();
      }
    }
  );

  return () => {
    unsubscribe();
  };
}, [eventId, event]);


  if (loading) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        Loading event details...
      </main>
    );
  }

  if (error && !event) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <Link href="/host-dashboard" className="text-sm text-blue-600">
          ← Back to Dashboard
        </Link>
        <p className="mt-6 rounded-lg bg-red-50 p-4 text-red-600">
          {error}
        </p>
      </main>
    );
  }

  if (!event) return null;

  function getQuestionsForCluster(clusterId: string) {
    
    const filteredQuestion = questions.filter(
      (question) => question.clusterId === clusterId
    );
    return filteredQuestion;
  }

  async function moderateQuestion(questionId: string) {
    const confirmed = confirm(
      "Remove this submitted question? The cluster and its votes will remain."
    );

    if (!confirmed) return;

    setError("");

    try {
      const jwt = await getAppwriteJWT();

      const response = await fetch("/api/questions/moderate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ questionId }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not remove question.");
      }

      // Reload clusters and questions after removal
      await loadEventData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    }
  }
  
  return (
    <main className="mx-auto max-w-5xl p-6">
      <Link
        href="/host-dashboard"
        className="text-sm text-blue-600 hover:underline"
      >
        ← Back to Dashboard
      </Link>

      {/* Event details */}
      <section className="mt-6 rounded-xl border p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">{event.title}</h1>
            <p className="mt-2 text-gray-500">
              Manage questions submitted by participants.
            </p>
          </div>

          <span className="rounded-full bg-green-100 px-4 py-2 text-sm font-medium text-green-700">
            {event.status}
          </span>
        </div>

        <div className="mt-5">
          <p className="text-xs text-gray-500">EVENT JOIN CODE</p>
          <p className="mt-1 text-2xl font-bold tracking-widest">
            {event.joinCode}
          </p>
        </div>
      </section>

      {/* Event controls */}
      <section className="mt-6 rounded-xl border p-6">
        <h2 className="text-xl font-bold">Event Controls</h2>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-500">
            Voting status:
          </span>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
            {event.votingStatus || "not_started"}
          </span>
        </div>

        {event.status === "closed" ? (
          <p className="mt-4 font-medium text-red-600">
            This event is closed. No further actions are available.
          </p>
        ) : (
          <div className="mt-5 flex flex-wrap gap-3">
            {event.votingStatus === "not_started" && (
              <button
                onClick={() => void controlEvent("start_voting")}
                disabled={actionLoading}
                className="rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
              >
                Start Voting
              </button>
            )}

            {event.votingStatus === "open" && (
              <button
                onClick={() => void controlEvent("pause_voting")}
                disabled={actionLoading}
                className="rounded-lg bg-yellow-500 px-4 py-2 text-white hover:bg-yellow-600 disabled:opacity-50"
              >
                Pause Voting
              </button>
            )}

            {event.votingStatus === "paused" && (
              <button
                onClick={() => void controlEvent("resume_voting")}
                disabled={actionLoading}
                className="rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
              >
                Resume Voting
              </button>
            )}

            {event.votingStatus !== "closed" && (
              <button
                onClick={() => {
                  if (confirm("Are you sure you want to close voting?")) {
                    void controlEvent("close_voting");
                  }
                }}
                disabled={actionLoading}
                className="rounded-lg border border-orange-500 px-4 py-2 text-orange-600 hover:bg-orange-50 disabled:opacity-50"
              >
                Close Voting
              </button>
            )}

            <button
              onClick={() => {
                if (confirm("Are you sure you want to close this event? This cannot be undone.")) {
                  void controlEvent("close_event");
                }
              }}
              disabled={actionLoading}
              className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
            >
              Close Event
            </button>
          </div>
        )}

        {actionLoading && (
          <p className="mt-3 text-sm text-gray-500">
            Updating event...
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
            {error}
          </p>
        )}
      </section>

      {/* Statistics */}
      <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border p-5">
          <p className="text-sm text-gray-500">Question Clusters</p>
          <p className="mt-2 text-3xl font-bold">{clusters.length}</p>
        </div>

        <div className="rounded-xl border p-5">
          <p className="text-sm text-gray-500">Total Questions</p>
          <p className="mt-2 text-3xl font-bold">
            {clusters.reduce((sum, c) => sum + (c.askCount ?? 0), 0)}
          </p>
        </div>

        <div className="rounded-xl border p-5">
          <p className="text-sm text-gray-500">Total Votes</p>
          <p className="mt-2 text-3xl font-bold">
            {clusters.reduce((sum, c) => sum + (c.voteCount ?? 0), 0)}
          </p>
        </div>
      </section>

      {/* Question clusters */}
      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Questions</h2>

          <button
            onClick={() => void loadEventData()}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-100"
          >
            Refresh
          </button>
        </div>

        {clusters.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed p-8 text-center">
            <p className="font-medium">No questions yet.</p>
            <p className="mt-2 text-sm text-gray-500">
              Questions submitted by participants will appear here.
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {clusters.map((cluster, index) => {
              return(
              <div key={cluster.$id} className="rounded-xl border p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <span className="text-lg font-bold text-gray-400">
                      #{index + 1}
                    </span>

                    <div>
                      <h3 className="text-lg font-semibold">
                        {cluster.title}
                      </h3>
                      <p className="mt-2 text-sm text-gray-500">
                        Asked {cluster.askCount ?? 0} times
                      </p>
                    </div>
                  </div>
                  
                  {/* Original questions dropdown */}
                  <details className="mt-4 rounded-lg border border-gray-700">
                    <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-semibold text-gray-300 hover:bg-gray-900">
                      Submitted questions ({getQuestionsForCluster(cluster.$id).length})
                    </summary>

                    <div className="space-y-2 border-t border-gray-700 p-3">
                      {getQuestionsForCluster(cluster.$id).map((question) => (
                        <div
                          key={question.$id}
                          className="flex items-start justify-between gap-3 rounded-md bg-gray-900 px-3 py-3"
                        >
                          <p className="text-sm text-gray-300">
                            {question.text}
                          </p>

                          <button
                            type="button"
                            onClick={() => void moderateQuestion(question.$id)}
                            className="shrink-0 rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
                          >
                            Remove
                          </button>
                        </div>
                      ))}

                      {getQuestionsForCluster(cluster.$id).length === 0 && (
                        <p className="text-sm text-gray-500">
                          No submitted questions found.
                        </p>
                      )}
                    </div>
                  </details>

                  <span className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700">
                    ▲ {cluster.voteCount ?? 0} votes
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <span className="text-sm text-gray-500">
                    Status: {cluster.status}
                  </span>

                  {cluster.answerText ? (
                    <span className="text-sm font-medium text-green-600">
                      Answer published
                    </span>
                  ) : (
                    <span className="text-sm text-orange-600">
                      Awaiting answer
                    </span>
                  )}
                </div>
                {/* Answer controls */}
                {event.status === "live" && cluster.status === "open" && (
                <div className="mt-4">
                    <button
                    onClick={() =>
                        void manageClusterAnswer(cluster.$id, "start_answering")
                    }
                    disabled={answerLoadingId === cluster.$id}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                    {answerLoadingId === cluster.$id
                        ? "Starting..."
                        : "Start Answering"}
                    </button>
                </div>
                )}

                {event.status === "live" && cluster.status === "answering" && (
                <div className="mt-4 space-y-3">
                    <textarea
                    value={answerDrafts[cluster.$id] ?? ""}
                    onChange={(e) =>
                        setAnswerDrafts((prev) => ({
                        ...prev,
                        [cluster.$id]: e.target.value,
                        }))
                    }
                    placeholder="Write your answer here..."
                    rows={4}
                    className="w-full rounded-lg border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />

                    <button
                    onClick={() =>
                        void manageClusterAnswer(cluster.$id, "publish_answer")
                    }
                    disabled={
                        answerLoadingId === cluster.$id ||
                        !(answerDrafts[cluster.$id] ?? "").trim()
                    }
                    className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
                    >
                    {answerLoadingId === cluster.$id
                        ? "Publishing..."
                        : "Publish Answer"}
                    </button>
                </div>
                )}
                {cluster.answerText && (
                  <div className="mt-4 rounded-lg bg-gray-50 p-4">
                    <p className="text-xs font-semibold text-gray-500">
                      PUBLISHED ANSWER
                    </p>
                    <p className="mt-2 text-sm">{cluster.answerText}</p>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

export default function HostEventPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-5xl p-6">
          Loading event dashboard...
        </main>
      }
    >
      <HostEventContent />
    </Suspense>
  );
}
