
import { redis } from "./redis";
import { randomUUID } from "crypto";

const LOCK_TTL = 60_000;
const RENEW_INTERVAL = 20_000;
const RETRY_DELAY = 200;
const MAX_WAIT_TIME = 30_000;

const RENEW_LOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
  end
  return 0
`;

const RELEASE_LOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withDistributedLock<T>(
  lockKey: string,
  task: () => Promise<T>
): Promise<T> {
  const token = randomUUID();
  const key = `askora:lock:${lockKey}`;
  const startTime = Date.now();

  let acquired = false;

  // 1. Acquire the lock.
  while (!acquired) {
    const result = await redis.set(key, token, {
      nx: true,
      px: LOCK_TTL,
    });

    if (result === "OK") {
      acquired = true;
      break;
    }

    if (Date.now() - startTime >= MAX_WAIT_TIME) {
      throw new Error("Could not acquire distributed lock in time.");
    }

    await sleep(RETRY_DELAY);
  }

  let stopHeartbeat = false;
  let lockLost = false;
  let renewalPromise: Promise<void> | null = null;

  // 2. Renew the lock periodically.
  const heartbeat = setInterval(() => {
    if (renewalPromise || stopHeartbeat) return;

    renewalPromise = (async () => {
      try {
        const result = await redis.eval(
          RENEW_LOCK_SCRIPT,
          [key],
          [token, String(LOCK_TTL)]
        );

        if (Number(result) !== 1) {
          lockLost = true;
          console.error("Distributed lock ownership lost:", key);
        }
      } catch (error) {
        lockLost = true;
        console.error("Lock renewal failed:", error);
      } finally {
        renewalPromise = null;
      }
    })();
  }, RENEW_INTERVAL);

  try {
    // 3. Execute the assignment pipeline.
    const result = await task();

    if (lockLost) {
      throw new Error("Distributed lock was lost during execution.");
    }

    return result;
  } finally {
    // 4. Stop heartbeat and wait for any ongoing renewal.
    stopHeartbeat = true;
    clearInterval(heartbeat);

    if (renewalPromise) {
      await renewalPromise;
    }

    // 5. Release only if this request still owns the lock.
    try {
      await redis.eval(
        RELEASE_LOCK_SCRIPT,
        [key],
        [token]
      );
    } catch (error) {
      console.error("Failed to release distributed lock:", error);
    }
  }
}
