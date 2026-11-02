"use client";

import { useState } from "react";
import { account } from "@/lib/appwrite";

export default function AppwriteTestPage() {
  const [result, setResult] = useState("Not tested");

  async function testConnection() {
    try {
      await account.get();
      setResult("Authenticated session found.");
    } catch {
      setResult(
        "Appwrite responded, but no authenticated session was found."
      );
    }
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold">AskOnce: Appwrite test</h1>

      <button
        className="mt-4 rounded-lg bg-black px-4 py-2 text-white"
        onClick={testConnection}
      >
        Test connection
      </button>

      <p className="mt-4" role="status">
        {result}
      </p>
      <button
        onClick={async () => {
          try {
            await account.deleteSession({
              sessionId: "current",
            });
            window.location.href = "/host-auth";
          } catch (error) {
            console.error("Logout failed:", error);
          }
        }}
      >
        Log out
      </button>
    </main>
  );
}