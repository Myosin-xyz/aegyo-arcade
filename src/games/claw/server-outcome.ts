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
import { ClawPlayRefusedError } from "./engine/outcome";
import { bootstrapSession } from "@/shell/session";

const RETRIES = 3;
const RETRY_DELAY_MS = 350;

async function ensureSession(signal: AbortSignal): Promise<void> {
  await bootstrapSession({ signal });
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
  // ONE durable idempotency key per unresolved drop OPERATION (M4 review
  // P1): a network-lost request may have committed server-side, so the
  // key survives every INDEFINITE failure and the next drop press
  // re-attempts the SAME operation — the server replays the original
  // outcome instead of consuming a second play. Only a DEFINITIVE
  // settle (2xx outcome, or a 4xx the server actually answered) clears
  // it.
  let durableKey: string | null = null;
  return async (): Promise<Outcome> => {
    durableKey ??= crypto.randomUUID();
    const idempotencyKey = durableKey;
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
          durableKey = null; // definitive: settled with an outcome
          return body.outcome;
        }
        if (res.status === 401) {
          // Session expired/missing — re-establish once, retry SAME key.
          sessionReady = false;
          lastError = new Error("session_rejected");
          continue;
        }
        if (res.status >= 400 && res.status < 500) {
          // Definitive refusal (promotion inactive / invalid attempt /
          // slot used / cap): the server answered — nothing was consumed
          // by THIS request, and no retry can ever succeed. Typed error
          // so callers end honestly instead of looping (M4 review P2).
          durableKey = null;
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new ClawPlayRefusedError(
            body.error ?? `rejected_${res.status}`,
            res.status,
          );
        }
        // 5xx: the server may have committed before failing — keep the
        // key (indefinite) and retry/fail without abandoning it.
        throw new Error(`claw play errored: ${res.status}`);
      } catch (error) {
        if (signal.aborted) throw error;
        lastError = error;
        if (durableKey === null) throw error; // definitive refusal above
        if (attempt < RETRIES - 1) {
          await delay(RETRY_DELAY_MS * (attempt + 1), signal);
        }
      }
    }
    throw lastError;
  };
}
