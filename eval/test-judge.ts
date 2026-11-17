import { loadEnvConfig } from "@next/env";
import { judge } from "../src/lib/judge";

loadEnvConfig(process.cwd());

async function main() {
  const result = await judge(
    "When is Assignment 3 due?",
    [
      {
        index: 0,
        text: "What is the submission deadline for Assignment 3?",
      },
    ]
  );

  console.log("Judge result:", result);
}

main().catch(console.error);