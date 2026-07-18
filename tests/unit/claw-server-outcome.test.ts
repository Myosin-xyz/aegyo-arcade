/**
 * Durable drop operation (M4 review P1): a network-lost request may have
 * committed server-side, so the idempotency key must SURVIVE indefinite
 * failures — the next drop re-attempts the same operation and the server
 * replays the original outcome. Only definitive settles (2xx outcome,
 * answered 4xx) mint a fresh key afterwards.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { serverOutcome } from "@/games/claw/server-outcome";

function keysFromCalls(
  calls: ReadonlyArray<readonly [unknown, (RequestInit | undefined)?]>,
) {
  return calls
    .filter(([url]) => String(url).includes("/api/claw/plays"))
    .map(
      ([, init]) =>
        (JSON.parse(String(init?.body)) as { idempotencyKey: string })
          .idempotencyKey,
    );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("claw server outcome — durable idempotency key", () => {
  it("keeps the SAME key across network failures; clears it on success", async () => {
    let failPlays = true;
    const fetchMock = vi.fn(async (url: unknown, _init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/api/session")) return new Response("{}");
      if (failPlays) throw new TypeError("network lost");
      return new Response(JSON.stringify({ outcome: "win", ordinal: 1 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = serverOutcome("attempt-1", new AbortController().signal);
    await expect(provider()).rejects.toThrow(); // 3 tries, all lost

    failPlays = false;
    await expect(provider()).resolves.toBe("win"); // re-attempt, SAME op

    const keys = keysFromCalls(fetchMock.mock.calls);
    expect(keys.length).toBeGreaterThanOrEqual(4);
    expect(new Set(keys).size).toBe(1); // one durable key across ALL tries

    // After a definitive settle, a new operation gets a new key.
    failPlays = true;
    await expect(provider()).rejects.toThrow();
    const keysAfter = keysFromCalls(fetchMock.mock.calls);
    expect(new Set(keysAfter).size).toBe(2);
  }, 20_000);

  it("a definitive 4xx clears the key (nothing was consumed)", async () => {
    const fetchMock = vi.fn(async (url: unknown, _init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/api/session")) return new Response("{}");
      return new Response(JSON.stringify({ error: "invalid_attempt" }), {
        status: 409,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = serverOutcome("attempt-2", new AbortController().signal);
    await expect(provider()).rejects.toThrow("claw play rejected: 409");
    await expect(provider()).rejects.toThrow("claw play rejected: 409");

    const keys = keysFromCalls(fetchMock.mock.calls);
    expect(keys).toHaveLength(2); // 4xx does NOT burn retries on one key
    expect(new Set(keys).size).toBe(2); // fresh operation each time
  });
});
