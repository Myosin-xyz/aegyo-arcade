/**
 * Single session-bootstrap helper (M4 review P1): EVERY /api/session
 * call submits both the device timezone and the RESOLVED locale — a
 * first-time Spanish device must create its device record as es-419,
 * not en (§12.1: the client preference updates the device record).
 */

import { getLocale } from "@/i18n/t";

export function sessionBootstrapBody(locale = getLocale()): string {
  return JSON.stringify({
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale,
  });
}

let inflight: Promise<Response> | null = null;

function send(init?: {
  signal?: AbortSignal;
  locale?: string;
}): Promise<Response> {
  return fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: sessionBootstrapBody(init?.locale as never),
    signal: init?.signal,
  });
}

export function bootstrapSession(init?: {
  signal?: AbortSignal;
  locale?: string;
}): Promise<Response> {
  const isDefault = init?.locale === undefined && init?.signal === undefined;
  if (isDefault) {
    // Deduplicate concurrent DEFAULT bootstraps (M4 review P1: two
    // cookie-less creates racing = two device identities). Nobody reads
    // the response body, so sharing the Response is safe.
    if (inflight) return inflight;
    const request = send();
    inflight = request;
    const clear = (): void => {
      if (inflight === request) inflight = null;
    };
    // BOTH branches handled — a bare .finally() creates a second
    // rejected promise nobody owns (M4 review P2: aborting /api/session
    // produced a page-level unhandled TypeError).
    request.then(clear, clear);
    return request;
  }
  // Explicit-locale / signal-scoped calls SERIALIZE behind any active
  // bootstrap: running them in parallel with a cookie-less create
  // reopens duplicate device creation (M4 review P1 — a rapid EN click
  // during a held-open Spanish bootstrap raced two creates). Once the
  // prior request settles (either way, cookie present or not), this
  // sends its own request.
  const prior: Promise<unknown> = inflight ?? Promise.resolve();
  const signal = init?.signal;
  if (!signal) {
    return prior.then(
      () => send(init),
      () => send(init),
    );
  }
  // The WAIT itself must observe the signal (M4 review P2): claw
  // teardown aborts the provider promptly even while a hung default
  // bootstrap is still pending — never park an abortable caller behind
  // an unrelated request.
  if (signal.aborted) {
    return Promise.reject(new DOMException("aborted", "AbortError"));
  }
  return new Promise<Response>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const proceed = (): void => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) return; // already rejected above — never send
      send(init).then(resolve, reject);
    };
    prior.then(proceed, proceed);
  });
}
