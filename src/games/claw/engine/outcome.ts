import type { Outcome } from "./types";

// The entire integration surface. Today it's a local stub. When a backend exists
// — wherever it ends up living — replace the stub with a function that calls it
// and returns "win" | "miss" | "drop". Nothing else in the engine changes.
export type OutcomeProvider = () => Promise<Outcome>;

interface Weights {
  win: number;
  miss: number;
  drop: number;
}

const DEFAULT_WEIGHTS: Weights = { win: 0.45, miss: 0.35, drop: 0.2 };

export function randomOutcome(
  weights: Weights = DEFAULT_WEIGHTS,
): OutcomeProvider {
  const total = weights.win + weights.miss + weights.drop;
  return () => {
    const r = Math.random() * total;
    if (r < weights.win) return Promise.resolve("win");
    if (r < weights.win + weights.miss) return Promise.resolve("miss");
    return Promise.resolve("drop");
  };
}

export function fixedOutcome(o: Outcome): OutcomeProvider {
  return () => Promise.resolve(o);
}

// Example of the eventual shape (left here as a reference, unused):
//
// export function serverOutcome(url: string, token: string): OutcomeProvider {
//   return async () => {
//     const res = await fetch(url, {
//       method: "POST",
//       headers: { authorization: `Bearer ${token}` },
//     });
//     const body = (await res.json()) as { outcome: Outcome };
//     return body.outcome;
//   };
// }

/**
 * The server ANSWERED and refused the play (invalid_attempt,
 * daily_slot_used, cap_reached, promotion inactive, ...). Terminal for
 * this drop AND this run's claw flow — pressing Drop again can never
 * succeed, so callers must surface an honest end instead of looping
 * TRY AGAIN (M4 review P2).
 */
export class ClawPlayRefusedError extends Error {
  constructor(
    readonly code: string,
    status: number,
  ) {
    super(`claw play rejected: ${status}`);
    this.name = "ClawPlayRefusedError";
  }
}
