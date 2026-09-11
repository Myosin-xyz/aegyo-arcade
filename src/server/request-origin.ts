import type { NextRequest } from "next/server";

function configuredOrigin(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && url.hostname === "localhost"))
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Reconstruct the public URL behind a known reverse proxy without deriving
 * authority from attacker-selected forwarding headers. The forwarded host is
 * useful only when it is exactly the separately configured application host.
 */
export function canonicalExternalRequestUrl(
  request: NextRequest,
  expectedOrigin = process.env.ARCADE_APP_ORIGIN,
): URL | null {
  if (expectedOrigin && !configuredOrigin(expectedOrigin)) return null;
  const expected = configuredOrigin(expectedOrigin);
  if (!expected) return new URL(request.url);

  const directHost = request.headers.get("host");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const requestUrl = new URL(request.url);
  const directIsExpected =
    directHost === expected.host || requestUrl.host === expected.host;
  const forwardedIsExpected =
    forwardedHost === expected.host &&
    forwardedProto === expected.protocol.slice(0, -1);
  if (!directIsExpected && !forwardedIsExpected) return null;

  const externalUrl = new URL(expected.href);
  externalUrl.pathname = requestUrl.pathname;
  externalUrl.search = requestUrl.search;
  return externalUrl;
}
