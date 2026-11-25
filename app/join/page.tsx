
"use client";

import { FormEvent, useState } from "react";
import { Query } from "appwrite";
import { account, tablesDB } from "@/lib/appwrite";
import { useRouter } from "next/navigation";

const databaseId =
  process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const eventsTableId =
  process.env.NEXT_PUBLIC_APPWRITE_EVENTS_TABLE_ID!;

export default function JoinEventPage() {
  const [code, setCode] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function joinEvent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setEventTitle("");

    try {
      try {
        await account.get();
      } catch {
        await account.createAnonymousSession();
      }

      const result = await tablesDB.listRows({
        databaseId,
        tableId: eventsTableId,
        queries: [
          Query.equal("joinCode", code.trim().toUpperCase()),
          Query.limit(1),
        ],
      });

      const event = result.rows[0];

      if (!event) {
        setMessage("No event found. Check the join code.");
        return;
      }

      if (event.status !== "live") {
        setMessage("This event is not currently accepting questions.");
        return;
      }

      router.push(`/event-board?eventId=${event.$id}`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not join event."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold">Join AskOnce</h1>

      <form onSubmit={joinEvent} className="mt-6 space-y-4">
        <input
          className="w-full rounded border p-3 uppercase"
          placeholder="Enter 6-character code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          minLength={6}
          maxLength={6}
          required
        />

        <button
          disabled={loading}
          className="w-full rounded bg-black p-3 text-white disabled:opacity-50"
        >
          {loading ? "Joining..." : "Join event"}
        </button>
      </form>

      {message && <p className="mt-4">{message}</p>}

      {eventTitle && (
        <section className="mt-5 rounded-xl border p-4">
          <h2 className="text-xl font-semibold">{eventTitle}</h2>
          <p className="mt-2 text-sm text-gray-500">
            You&apos;re in! The question submission screen comes next.
          </p>
        </section>
      )}
    </main>
  );
}
