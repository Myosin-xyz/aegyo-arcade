/**
 * Server-authoritative claw outcome provider — COUNTED runs only
 * (TECH_SPEC §9.4; M1 review B1). Practice outcomes are local and never
 * touch the server.
 *
 * One idempotency key per DROP, held across retries — a lost response never
 * consumes a second play; the server returns the original outcome for the
 * same key. Every fetch and retry delay is tied to the RunContext signal
 * (M1 review B6): tearing the run down aborts the whole provider.
 */

import type { Outcome } from "./engine/types";
import type { OutcomeProvider } from "./engine/outcome";

const RETRIES = 3;
const RETRY_DELAY_MS = 350;

async function ensureSession(signal: AbortSignal): Promise<void> {
  await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    signal,
  });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function serverOutcome(
  attemptId: string,
  signal: AbortSignal,
): OutcomeProvider {
  let sessionReady = false;
  return async (): Promise<Outcome> => {
    const idempotencyKey = crypto.randomUUID();
    let lastError: unknown = new Error("claw outcome unavailable");

    for (let attempt = 0; attempt < RETRIES; attempt++) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      try {
        if (!sessionReady) {
          await ensureSession(signal);
          sessionReady = true;
        }
        const res = await fetch("/api/claw/plays", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey, attemptId }),
          signal,
        });
        if (res.ok) {
          const body = (await res.json()) as { outcome: Outcome };
          return body.outcome;
        }
        if (res.status === 401) {
          // Session expired/missing — re-establish once, retry SAME key.
          sessionReady = false;
          lastError = new Error("session_rejected");
          continue;
        }
        // 409 (promotion inactive / invalid attempt / cap) and 5xx: fail
        // closed — the engine resets without playing an animation (§10.1).
        throw new Error(`claw play rejected: ${res.status}`);
      } catch (error) {
        if (signal.aborted) throw error;
        lastError = error;
        if (attempt < RETRIES - 1) {
          await delay(RETRY_DELAY_MS * (attempt + 1), signal);
        }
      }
    }
    throw lastError;
  };
}
