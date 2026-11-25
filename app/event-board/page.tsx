"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Channel, Query, Realtime } from "appwrite";
import { useRouter } from "next/navigation";
import { account, client, tablesDB, getAppwriteJWT, ensureUserSession, getTestJWT} from "@/lib/appwrite";

const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const clustersTableId =
  process.env.NEXT_PUBLIC_APPWRITE_CLUSTERS_TABLE_ID!;
const eventTableId = process.env.NEXT_PUBLIC_APPWRITE_EVENTS_TABLE_ID;

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

type VoteState = {
  allocations: Record<string, number>;
  lockedCredits: number;
  editableCredits: number;
  remainingCredits: number;
  votingStatus: string;
  eventStatus: string;
};

export default function EventBoardPage() {
  const router = useRouter();

  const [eventInput, setEventInput] = useState("");
  const [activeEventId, setActiveEventId] = useState("");
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [questionText, setQuestionText] = useState("");
  const [isSubmittingQuestion, setIsSubmittingQuestion] = useState(false);
  const [questionMessage, setQuestionMessage] = useState("");

  const [voteState, setVoteState] = useState<VoteState>({
    allocations: {},
    lockedCredits: 0,
    editableCredits: 0,
    remainingCredits: 3,
    votingStatus: "not_started",
    eventStatus: "live",
  });

  const idempotencyKeyRef = useRef<{
    eventId: string;
    text: string;
    key: string;
  } | null>(null);

  const [votingClusterId, setVotingClusterId] = useState("");

  // Read eventId from the URL after joining an event.
  useEffect(() => {
    const eventId = new URLSearchParams(window.location.search).get("eventId");

    if (eventId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEventInput(eventId);

      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveEventId(eventId);
    }
  }, []);

  async function loadVoteState(eventId: string) {
    const jwt = await getAppwriteJWT();

    const response = await fetch(
      `/api/votes?eventId=${encodeURIComponent(eventId)}`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load your votes.");
    }

    setVoteState({
      allocations: data.allocations ?? {},
      lockedCredits: data.lockedCredits ?? 0,
      editableCredits: data.editableCredits ?? 0,
      remainingCredits: data.remainingCredits ?? 3,
      votingStatus: data.votingStatus ?? "not_started",
      eventStatus: data.eventStatus ?? "live",
    });
  }

  useEffect(() => {
    if (!activeEventId) return;

    let cancelled = false;

    let clusterSubscription:
      | Awaited<ReturnType<Realtime["subscribe"]>>
      | undefined;

    let eventSubscription:
      | Awaited<ReturnType<Realtime["subscribe"]>>
      | undefined;

    async function loadClusters() {
      try {
        const result = await tablesDB.listRows({
          databaseId,
          tableId: clustersTableId,
          queries: [
            Query.equal("eventId", activeEventId),
            Query.limit(100),
          ],
        });

        if (cancelled) return;

        const rows = result.rows as unknown as Cluster[];

        rows.sort(
          (a, b) =>
            (b.askCount ?? 0) - (a.askCount ?? 0) ||
            (b.score ?? 0) - (a.score ?? 0)
        );

        setClusters(rows);
        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not load questions."
          );
        }
      }
    }

    async function startRealtime() {
      try {
        // Ensuring participant has an Appwrite session.
        const user = await ensureUserSession();
        await Promise.all([
          loadClusters(),
          loadVoteState(activeEventId),
        ]);

        if (cancelled) return;

        const realtime = new Realtime(client);

        clusterSubscription = await realtime.subscribe(
          Channel.tablesdb(databaseId).table(clustersTableId).row(),
          (response) => {
            if (cancelled) return;

            const payload = response.payload as Partial<Cluster>;

            if (payload.eventId !== activeEventId || !payload.$id) {
              return;
            }
            setClusters((previousClusters) => {
              const clusterExists = previousClusters.some(
                (cluster) => cluster.$id === payload.$id
              );

              if (!clusterExists) {
                // A new question cluster was created.
                // Load the list to include it.
                void loadClusters();
                return previousClusters;
              }

              // Update only the cluster that changed.
              return previousClusters.map((cluster) =>
                cluster.$id === payload.$id
                  ? { ...cluster, ...payload }
                  : cluster
              );
            });
          }
        );

        if (!eventTableId) {
          throw new Error("Events table ID is missing.");
        }
        eventSubscription = await realtime.subscribe(
          Channel.tablesdb(databaseId).table(eventTableId).row(),
          (response) => {
            if (cancelled) return;

            const payload = response.payload as Record<string, unknown>;
            if (payload.$id === activeEventId) {
              void loadVoteState(activeEventId);
            }
          }
        );

        if (!cancelled) {
          setConnected(true);
        } else {
          await clusterSubscription?.unsubscribe();
          await eventSubscription?.unsubscribe();
        }
      } catch (err) {
        if (!cancelled) {
          setConnected(false);
          setError(
            err instanceof Error
              ? err.message
              : "Could not connect to live updates."
          );
        }
      }
    }

    void startRealtime();

    return () => {
      cancelled = true;
      setConnected(false);
      void clusterSubscription?.unsubscribe();
      void eventSubscription?.unsubscribe();
    };
  }, [activeEventId]);

  useEffect(() => {
    async function printJWT() {
      const jwt = await getTestJWT();
    }

    printJWT();
  }, []);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const id = eventInput.trim();

    if (!id) {
      setError("Enter an event row ID.");
      return;
    }

    setLoading(true);
    setError("");
    setClusters([]);
    setVoteState({
      allocations: {},
      lockedCredits: 0,
      editableCredits: 0,
      remainingCredits: 3,
      votingStatus: "not_started",
      eventStatus: "live",
    });

    setActiveEventId(id);
    router.replace(`/event-board?eventId=${encodeURIComponent(id)}`);
    setLoading(false);
  }

  async function handleVote(cluster: Cluster) {
    if (votingClusterId) return;

    const currentVote = voteState.allocations[cluster.$id] ?? 0;
    const credits = currentVote === 1 ? 0 : 1;

    setVotingClusterId(cluster.$id);
    setError("");

    try {
      const jwt = await getAppwriteJWT();

      const response = await fetch("/api/votes", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clusterId: cluster.$id,
          credits,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not update your vote.");
      }

      await loadVoteState(activeEventId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update your vote."
      );
    } finally {
      setVotingClusterId("");
    }
  }

  async function handleSubmitQuestion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const text = questionText.trim();

    if (
      !idempotencyKeyRef.current ||
      idempotencyKeyRef.current.eventId !== activeEventId ||
      idempotencyKeyRef.current.text !== text
    ) {
      idempotencyKeyRef.current = {
        eventId: activeEventId,
        text,
        key: crypto.randomUUID(),
      };
    }

const idempotencyKey = idempotencyKeyRef.current.key;
    if (!activeEventId || !text || isSubmittingQuestion) return;

    setIsSubmittingQuestion(true);
    setQuestionMessage("");
    setError("");

    try {
      const jwt = await getAppwriteJWT();

      const response = await fetch("/api/questions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          eventId: activeEventId,
          text,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to submit question.");
      }

      if (result.matchedExistingCluster) {
        if (result.clusterStatus === "answered") {
          const answer =
            typeof result.existingAnswer === "string"
              ? result.existingAnswer.trim()
              : "";

          setQuestionMessage(
            answer
              ? `This question has already been answered: ${answer}`
              : "This question has already been answered."
          );
        } else if (result.clusterStatus === "answering") {
          setQuestionMessage("This question is currently being answered.");
        } else {
          setQuestionMessage("Your question was added to an existing question.");
        }
      } else {
        setQuestionMessage("Your question was submitted successfully.");
      }

      setQuestionText("");

      idempotencyKeyRef.current = null;

      // Refresh participant vote state.
      await loadVoteState(activeEventId);

      // The existing cluster realtime subscription will refresh the board.
    } catch (err) {
      setQuestionMessage(
        err instanceof Error
          ? err.message
          : "Something went wrong while submitting."
      );
    } finally {
      setIsSubmittingQuestion(false);
    }
  }

  const votingOpen =
    voteState.eventStatus === "live" &&
    voteState.votingStatus === "open";

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-10">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-600">
          Askora · Live Event
        </p>
        <h1 className="mt-2 text-3xl font-bold">Question Board</h1>
        <p className="mt-2 text-gray-500">
          Similar questions are grouped together and popular questions appear
          first.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="mb-8 flex flex-col gap-3 sm:flex-row"
      >
        <input
          value={eventInput}
          onChange={(e) => setEventInput(e.target.value)}
          placeholder="Event ID (auto-filled after joining)"
          className="min-w-0 flex-1 rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Open board"}
        </button>
      </form>

      {activeEventId && (
        <>
          <div className="mb-4 flex items-center gap-2 text-sm">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                connected ? "bg-green-500" : "bg-amber-500"
              }`}
            />
            {connected
              ? "Live updates connected"
              : "Loading board or connecting..."}
          </div>

          <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-blue-900">Your voting budget</p>
              <p className="text-sm font-semibold text-blue-800">
                {voteState.remainingCredits} / 3 votes left
              </p>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{
                  width: `${
                    ((3 - voteState.remainingCredits) / 3) * 100
                  }%`,
                }}
              />
            </div>

            <p className="mt-2 text-xs text-blue-800">
              {voteState.lockedCredits} locked · {voteState.editableCredits}{" "}
              editable
            </p>

            <p className="mt-2 text-sm text-blue-900">
              {votingOpen
                ? "Vote for up to 3 different questions. You can remove or move votes while voting is open."
                : voteState.votingStatus === "paused"
                ? "Voting is paused. Your current votes are saved."
                : voteState.votingStatus === "closed"
                ? "Voting is closed. Your current votes are locked."
                : "Voting has not started yet."}
            </p>
          </div>
        </>
      )}

      {error && (
        <p className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </p>
      )}

      {activeEventId && !error && clusters.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center">
          <h2 className="font-semibold">No questions yet</h2>
          <p className="mt-2 text-sm text-gray-500">
            Questions submitted to this event will appear here.
          </p>
        </div>
      )}

      {activeEventId && (
        <section className="mb-6 rounded-xl border border-white/10 bg-[#111111] p-4 shadow-sm">
          <h2>
            Ask a question
          </h2>

          <form onSubmit={handleSubmitQuestion} className="space-y-3">
            <textarea
              value={questionText}
              onChange={(e) => {
                setQuestionText(e.target.value);
                setQuestionMessage("");
              }}
              placeholder="Type your question here..."
              rows={3}
              maxLength={500}
              className="w-full resize-y rounded-lg border border-white/15 bg-[#0a0a0a] p-3 text-sm text-white placeholder:text-gray-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-gray-400">
                {questionText.length}/500 characters
              </span>

              <button
                type="submit"
                disabled={!questionText.trim() || isSubmittingQuestion || !activeEventId}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmittingQuestion ? "Submitting..." : "Submit question"}
              </button>
            </div>

            {questionMessage && (
              <p className="text-sm text-gray-400">
                {questionMessage}
              </p>
            )}
          </form>
        </section> 
      )}
      <section className="space-y-4">
        {clusters.map((cluster, index) => {
          const hasVoted = voteState.allocations[cluster.$id] === 1;
          const isLocked = cluster.status !== "open";
          const canVote = votingOpen && !isLocked;
          const isProcessing = votingClusterId === cluster.$id;

          return (
            <article
              key={cluster.$id}
              className="rounded-2xl border border-gray-200 p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 font-bold text-blue-700">
                    {index + 1}
                  </span>

                  <div>
                    <h2 className="font-semibold leading-6">{cluster.title}</h2>
                    <p className="mt-2 text-sm text-gray-500">
                      {cluster.askCount ?? 0}{" "}
                      {(cluster.askCount ?? 0) === 1 ? "ask" : "asks"}
                      {" · "}
                      {cluster.voteCount ?? 0}{" "}
                      {(cluster.voteCount ?? 0) === 1 ? "vote" : "votes"}
                    </p>
                  </div>
                </div>

                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                    cluster.status === "answered"
                      ? "bg-green-100 text-green-700"
                      : cluster.status === "answering"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {cluster.status === "answered"
                    ? "Answered"
                    : cluster.status === "answering"
                    ? "Host is answering"
                    : "Open"}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                {hasVoted && (
                  <p className="text-sm font-medium text-blue-700">
                    {isLocked ? "Your vote is locked" : "You voted for this"}
                  </p>
                )}

                {canVote && (
                  <button
                    type="button"
                    onClick={() => void handleVote(cluster)}
                    disabled={!!votingClusterId}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
                      hasVoted
                        ? "border border-gray-300 text-gray-700 hover:bg-gray-50"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    {isProcessing
                      ? "Updating..."
                      : hasVoted
                      ? "Remove vote"
                      : "Vote"}
                  </button>
                )}

                {!canVote && !isLocked && (
                  <p className="text-sm text-gray-500">
                    Voting is not currently open
                  </p>
                )}
              </div>

              {cluster.status === "answering" && !cluster.answerText && (
                <div className="mt-4 rounded-xl bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-700">
                    The host is answering this question...
                  </p>
                </div>
              )}

              {cluster.answerText && (
                <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
                  <p className="text-xs font-semibold uppercase text-green-700">
                    Published Answer
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                    {cluster.answerText}
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}

