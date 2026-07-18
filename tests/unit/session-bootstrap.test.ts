/**
 * Shared session bootstrap (M4 review P1): concurrent default calls
 * deduplicate to ONE request (two cookie-less creates racing = two
 * device identities), the body always carries the resolved locale, and
 * explicit-locale calls (the toggle) bypass the dedupe.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapSession } from "@/shell/session";
import { setLocale } from "@/i18n/t";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  setLocale("en");
});

describe("bootstrapSession", () => {
  it("dedupes concurrent default bootstraps into one request", async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const a = bootstrapSession();
    const b = bootstrapSession(); // in-flight → shared
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(new Response("{}"));
    await Promise.all([a, b]);

    // Settled → the next call is a fresh request (a normal touch).
    const c = bootstrapSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveFetch(new Response("{}"));
    await c;
  });

  it("explicit locale SERIALIZES behind an active bootstrap (M4 review P1: rapid-toggle race)", async () => {
    let resolveFirst!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        fetchMock.mock.calls.length === 1
          ? pending
          : Promise.resolve(new Response("{}")),
    );
    vi.stubGlobal("fetch", fetchMock);

    const auto = bootstrapSession(); // held-open cookie-less create
    const toggle = bootstrapSession({ locale: "en" }); // EN click mid-flight
    await new Promise((r) => setTimeout(r, 0));
    // The explicit request must NOT run in parallel with the create.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirst(new Response("{}")); // cookie lands
    await auto;
    await toggle; // now the toggle's own request goes out
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const toggleBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      locale: string;
    };
    expect(toggleBody.locale).toBe("en");
  });

  it("a REJECTED bootstrap clears cleanly: caller catches, no unhandled rejection, next call is fresh (M4 review P2)", async () => {
    let call = 0;
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        call++;
        return call === 1
          ? Promise.reject(new TypeError("Failed to fetch"))
          : Promise.resolve(new Response("{}"));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(bootstrapSession()).rejects.toThrow("Failed to fetch");
    // inflight cleared through the handled failure branch → fresh retry.
    await expect(bootstrapSession()).resolves.toBeInstanceOf(Response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // An unhandled rejection from a stray .finally() would fail this
    // test file at the runner level — reaching here IS the assertion.
  });

  it("ABORT during the serialized wait rejects promptly and never sends (M4 review P2)", async () => {
    let resolveFirst!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        fetchMock.mock.calls.length === 1
          ? pending
          : Promise.resolve(new Response("{}")),
    );
    vi.stubGlobal("fetch", fetchMock);

    void bootstrapSession().catch(() => undefined); // held-open create
    const controller = new AbortController();
    const waiting = bootstrapSession({ signal: controller.signal });

    controller.abort(); // claw teardown while the prior request hangs
    await expect(waiting).rejects.toThrow("aborted"); // PROMPT — prior unsettled
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirst(new Response("{}")); // prior finally settles…
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1); // …and still no send
  });

  it("always sends the RESOLVED locale; explicit locale sends its own request when idle", async () => {
    setLocale("es-419");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}"),
    );
    vi.stubGlobal("fetch", fetchMock);

    await bootstrapSession();
    const defaultBody = JSON.parse(
      String(fetchMock.mock.calls[0][1]?.body),
    ) as { locale: string; timeZone: string };
    expect(defaultBody.locale).toBe("es-419");
    expect(typeof defaultBody.timeZone).toBe("string");

    await bootstrapSession({ locale: "en" }); // toggle-style explicit call
    expect(fetchMock).toHaveBeenCalledTimes(2); // idle → sends immediately
    const explicitBody = JSON.parse(
      String(fetchMock.mock.calls[1][1]?.body),
    ) as { locale: string };
    expect(explicitBody.locale).toBe("en");
  });
});
