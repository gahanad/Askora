
"use client";

import { FormEvent, useState } from "react";
import { ID } from "appwrite";
import { account } from "@/lib/appwrite";
import { useRouter } from "next/navigation";

export default function HostAuthPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      if (mode === "signup") {
        await account.create({
          userId: ID.unique(),
          name: name.trim(),
          email: email.trim(),
          password,
        });
      }

      await account.createEmailPasswordSession({
        email: email.trim(),
        password,
      });

      const user = await account.get();

      setMessage(`Signed in successfully as ${user.name || user.email}.`);

      // Redirect to Host Dashboard after successful authentication
      router.replace("/host-dashboard");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Authentication failed."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold">AskOnce Host</h1>

      <div className="my-5 flex gap-3">
        <button
          type="button"
          onClick={() => setMode("signup")}
          className="rounded border px-3 py-2"
        >
          Sign up
        </button>

        <button
          type="button"
          onClick={() => setMode("login")}
          className="rounded border px-3 py-2"
        >
          Log in
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === "signup" && (
          <input
            className="w-full rounded border p-3"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        )}

        <input
          className="w-full rounded border p-3"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <input
          className="w-full rounded border p-3"
          type="password"
          placeholder="Password (at least 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />

        <button
          className="w-full rounded bg-black p-3 text-white disabled:opacity-50"
          disabled={loading}
        >
          {loading
            ? "Please wait..."
            : mode === "signup"
              ? "Create account"
              : "Log in"}
        </button>
      </form>

      <p className="mt-4 break-words" role="status">
        {message}
      </p>
    </main>
  );
}
