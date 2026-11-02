
"use client";

import { useState } from "react";
import { account } from "@/lib/appwrite";

export default function JWTTestPage() {
  const [message, setMessage] = useState("");
  const [jwt, setJwt] = useState("");
  const [loading, setLoading] = useState(false);

  async function generateJWT() {
    setLoading(true);
    setMessage("");
    setJwt("");

    try {
      // Verify that a user is signed in.
      await account.get();

      // Generate a short-lived Appwrite JWT.
      const result = await account.createJWT();

      setJwt(result.jwt);
      setMessage("JWT generated successfully.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not generate JWT."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-4 text-2xl font-bold">
        Appwrite JWT Test
      </h1>

      <button
        onClick={generateJWT}
        disabled={loading}
        className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {loading ? "Generating..." : "Generate JWT"}
      </button>

      {message && <p className="mt-4">{message}</p>}

      {jwt && (
        <div className="mt-4">
          <p className="mb-2 font-medium">
            JWT — keep this private
          </p>
          <textarea
            readOnly
            value={jwt}
            className="w-full rounded-lg border p-3 text-sm"
            rows={5}
          />
          <button
            onClick={() => navigator.clipboard.writeText(jwt)}
            className="mt-2 rounded-lg border px-3 py-2"
          >
            Copy JWT
          </button>
        </div>
      )}
    </main>
  );
}
