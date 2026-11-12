"use client";

import { FormEvent, useEffect, useState } from "react";
import { ID, Permission, Role, Query } from "appwrite";
import { account, tablesDB } from "@/lib/appwrite";
import Link from "next/link";

const databaseId =
  process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const eventsTableId =
  process.env.NEXT_PUBLIC_APPWRITE_EVENTS_TABLE_ID!;
  

type Event = {
  $id: string;
  hostId: string;
  title: string;
  joinCode: string;
  status: string;
  $createdAt?: string;
};

function generateJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = crypto.getRandomValues(new Uint8Array(6));

  return Array.from(values, (v) => chars[v % chars.length]).join("");
}

export default function HostDashboard() {
  const [title, setTitle] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [message, setMessage] = useState("");

  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [listError, setListError] = useState("");

  // Fetch events belonging to the logged-in host
  async function loadEvents() {
    setEventsLoading(true);
    setListError("");

    try {
      const user = await account.get();

      const result = await tablesDB.listRows({
        databaseId,
        tableId: eventsTableId,
        queries: [
          Query.equal("hostId", user.$id),
          Query.limit(100),
        ],
      });

      const rows = result.rows as unknown as Event[];

      rows.sort(
        (a, b) =>
          new Date(b.$createdAt ?? 0).getTime() -
          new Date(a.$createdAt ?? 0).getTime()
      );

      setEvents(rows);
    } catch (error) {
      setListError(
        error instanceof Error
          ? error.message
          : "Could not load your events."
      );
    } finally {
      setEventsLoading(false);
    }
  }

  // Load events when dashboard opens
  useEffect(() => {
    void loadEvents();
  }, []);

  // Create a new event
  async function createEvent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setLoading(true);
    setMessage("");
    setJoinCode("");

    try {
      const user = await account.get();
      const code = generateJoinCode();

      await tablesDB.createRow({
        databaseId,
        tableId: eventsTableId,
        rowId: ID.unique(),
        data: {
          hostId: user.$id,
          title: title.trim(),
          joinCode: code,
          status: "live",
          strictness: 0.85,
          votingStatus: "not_started",
        },
        permissions: [
          Permission.read(Role.users()),
          Permission.update(Role.user(user.$id)),
          Permission.delete(Role.user(user.$id)),
        ],
      });

      setJoinCode(code);
      setMessage("Event created successfully!");
      setTitle("");

      // Refresh event list after creation
      await loadEvents();

    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not create event."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6">

      {/* Dashboard heading */}
      <div>
        <h1 className="text-3xl font-bold">
          Host Dashboard
        </h1>
        <p className="mt-2 text-gray-500">
          Create and manage your live Q&A events.
        </p>
      </div>

      {/* Create Event */}
      <section className="mt-8 rounded-xl border p-6">
        <h2 className="text-xl font-semibold">
          Create a New Event
        </h2>

        <form onSubmit={createEvent} className="mt-5 space-y-4">
          <input
            className="w-full rounded-lg border p-3"
            placeholder="Enter event title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            minLength={3}
            maxLength={100}
            required
          />

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-black px-5 py-3 text-white disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create event"}
          </button>
        </form>

        {message && (
          <p className="mt-4 text-sm">
            {message}
          </p>
        )}

        {joinCode && (
          <div className="mt-5 rounded-lg bg-gray-100 p-4">
            <p className="text-sm text-gray-500">
              Share this join code with participants
            </p>

            <p className="mt-2 text-3xl font-bold tracking-widest text-black">
              {joinCode}
            </p>
          </div>
        )}
      </section>

      {/* My Events */}
      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">
            My Events
          </h2>

          <button
            onClick={() => void loadEvents()}
            disabled={eventsLoading}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-100"
          >
            {eventsLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {eventsLoading && (
          <p className="mt-5 text-gray-500">
            Loading your events...
          </p>
        )}

        {listError && (
          <p className="mt-5 rounded-lg bg-red-50 p-3 text-red-600">
            {listError}
          </p>
        )}

        {!eventsLoading && !listError && events.length === 0 && (
          <div className="mt-5 rounded-xl border border-dashed p-8 text-center">
            <p className="font-medium">
              No events created yet.
            </p>
            <p className="mt-2 text-sm text-gray-500">
              Create your first event above!
            </p>
          </div>
        )}

        {/* Event cards */}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {events.map((event) => (
            <Link
              href={`/host-dashboard/${event.$id}`}
              key={event.$id}
              className="block rounded-xl border p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-semibold">
                  {event.title}
                </h3>

                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    event.status === "live"
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {event.status}
                </span>
              </div>

              <div className="mt-5">
                <p className="text-xs text-gray-500">
                  JOIN CODE
                </p>

                <p className="mt-1 text-2xl font-bold tracking-widest">
                  {event.joinCode}
                </p>
              </div>

              <p className="mt-4 text-xs text-gray-400">
                Event ID: {event.$id}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}