import { createServer } from "node:http";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { renderAccountPage, accountsCss, accountsJs } from "../ui/pages.mjs";
import { clientIP } from "./config.mjs";
import {
  authorizedReader,
  readSessionState,
  checkDatabaseReadiness,
} from "./security-state.mjs";

const pages = new Set([
  "sign-in",
  "sign-up",
  "forgot-password",
  "reset-password",
  "verify-email",
  "account",
]);
const statuses = new Set([
  "idle",
  "sent",
  "success",
  "invalid",
  "expired",
  "error",
]);
const csp =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; font-src 'self'";

export async function registeredContinuation(database, baseURL, url) {
  let query = url.searchParams;
  const continued = query.get("continue");
  if (continued) {
    let next;
    try {
      next = new URL(continued, baseURL);
    } catch {
      return {};
    }
    if (
      next.origin !== baseURL ||
      next.pathname !== "/api/auth/oauth2/authorize"
    )
      return {};
    query = next.searchParams;
  }
  if (
    !query.get("sig") ||
    !query.get("client_id") ||
    !query.get("redirect_uri")
  )
    return {};
  const row = (
    await database.query(
      'SELECT "redirectUris", disabled FROM public."oauthClient" WHERE "clientId"=$1',
      [query.get("client_id")],
    )
  ).rows[0];
  let allowed = row?.redirectUris;
  if (typeof allowed === "string") {
    try {
      allowed = JSON.parse(allowed);
    } catch {
      allowed = [];
    }
  }
  if (
    row?.disabled ||
    !Array.isArray(allowed) ||
    !allowed.includes(query.get("redirect_uri"))
  )
    return {};
  // Signature and expiry verification remain exclusively in the provider's oauth_query hook.
  // This lookup only allows the UI to navigate to a registered callback returned by that hook.
  return {
    oauthQuery: query.toString(),
    continuationUrl: `${baseURL}/api/auth/oauth2/authorize?${query}`,
    trustedRedirectUri: query.get("redirect_uri"),
  };
}

export function createAccountsServer({
  auth,
  database,
  config,
  readiness = checkDatabaseReadiness,
}) {
  const providerHandler =
    config.trafficEnabled === false ? null : toNodeHandler(auth);
  const canonical = new URL(config.baseURL);
  let checkedAt = 0;
  let ready = false;
  async function isReady(force = false) {
    if (force || Date.now() - checkedAt > 5_000) {
      ready = await readiness(database).catch(() => false);
      checkedAt = Date.now();
    }
    return ready;
  }
  const server = createServer(
    { requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 16_384 },
    async (req, res) => {
      res.setHeader("cache-control", "no-store");
      res.setHeader("referrer-policy", "no-referrer");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("content-security-policy", csp);
      res.setHeader("strict-transport-security", "max-age=31536000");
      const send = (
        status,
        value,
        contentType = "application/json; charset=utf-8",
      ) => {
        res.writeHead(status, { "content-type": contentType });
        res.end(typeof value === "string" ? value : JSON.stringify(value));
      };
      try {
        if (config.trafficEnabled === false) {
          if (req.method === "GET" && req.url === "/healthz")
            return send(200, { ok: true });
          return send(503, { error: "accounts_not_activated" });
        }
        if (
          !req.url?.startsWith("/") ||
          req.url.startsWith("//") ||
          req.url.length > 16_384
        )
          return send(400, { error: "invalid_request" });
        const url = new URL(req.url, config.baseURL);
        if (url.pathname === "/healthz") return send(200, { ok: true });
        if (url.pathname === "/readyz")
          return send((await isReady(true)) ? 200 : 503, { ready });
        if (url.pathname === "/assets/accounts.css")
          return send(200, accountsCss, "text/css; charset=utf-8");
        if (url.pathname === "/assets/accounts.js")
          return send(200, accountsJs, "text/javascript; charset=utf-8");
        if (
          url.pathname === "/api/internal/proxy-proof" &&
          config.environment !== "staging"
        )
          return send(404, { error: "not_found" });
        if (!(await isReady()))
          return send(503, { error: "accounts_temporarily_unavailable" });
        if (
          ["/api/internal/session-state", "/api/internal/proxy-proof"].includes(
            url.pathname,
          ) &&
          !authorizedReader(req.headers.authorization, config.readers)
        )
          return send(401, { error: "unauthorized" });
        if (!["GET", "POST"].includes(req.method))
          return send(405, { error: "method_not_allowed" });
        let rawBody;
        if (req.method === "POST") {
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 16_384) return send(413, { error: "request_too_large" });
            chunks.push(chunk);
          }
          rawBody = Buffer.concat(chunks);
        }
        if (url.pathname === "/api/internal/proxy-proof") {
          if (req.method !== "POST")
            return send(405, { error: "method_not_allowed" });
          const realIP =
            typeof req.headers["x-real-ip"] === "string"
              ? req.headers["x-real-ip"]
              : null;
          return send(200, {
            realIP,
            normalizedIP: clientIP(req, "railway-x-real-ip"),
          });
        }
        if (url.pathname === "/api/internal/session-state") {
          if (req.method !== "POST")
            return send(405, { error: "method_not_allowed" });
          let input;
          try {
            input = JSON.parse(rawBody.toString("utf8"));
          } catch {
            return send(400, { error: "invalid_request" });
          }
          const state = await readSessionState(database, input);
          return send(state ? 200 : 400, state || { error: "invalid_request" });
        }
        // Canonical host/protocol and a server-owned IP header prevent forwarded-header spoofing.
        req.headers["x-aegyo-client-ip"] = clientIP(req, config.ipMode);
        req.headers.host = canonical.host;
        delete req.headers[":authority"];
        req.headers["x-forwarded-proto"] = "https";
        delete req.headers["x-forwarded-host"];
        delete req.headers.forwarded;
        if (
          url.pathname.startsWith("/api/auth/") ||
          url.pathname.startsWith("/.well-known/")
        ) {
          // Use the official adapter on GET. POST has already been bounded, so pass
          // a standard Request to the same maintained provider handler.
          if (req.method === "GET") return await providerHandler(req, res);
          const headers = fromNodeHeaders(req.headers);
          headers.delete("content-length");
          const response = await auth.handler(
            new Request(url.href, { method: "POST", headers, body: rawBody }),
          );
          res.statusCode = response.status;
          for (const [name, value] of response.headers)
            if (name !== "set-cookie") res.setHeader(name, value);
          const cookies = response.headers.getSetCookie();
          if (cookies.length) res.setHeader("set-cookie", cookies);
          return res.end(Buffer.from(await response.arrayBuffer()));
        }
        if (req.method !== "GET")
          return send(405, { error: "method_not_allowed" });
        if (url.pathname === "/") {
          res.writeHead(302, { location: "/account" });
          return res.end();
        }
        const page = url.pathname.slice(1);
        if (!pages.has(page)) return send(404, { error: "not_found" });
        const session =
          page === "account"
            ? await auth.api.getSession({
                headers: fromNodeHeaders(req.headers),
              })
            : null;
        if (page === "account" && !session) {
          res.writeHead(302, { location: "/sign-in" });
          return res.end();
        }
        const locale = url.searchParams.get("lang") === "es" ? "es" : "en";
        const continuation = await registeredContinuation(
          database,
          config.baseURL,
          url,
        );
        return send(
          200,
          renderAccountPage({
            page,
            locale,
            ...continuation,
            status:
              url.searchParams.get("error") === "INVALID_TOKEN"
                ? "invalid"
                : statuses.has(url.searchParams.get("status"))
                  ? url.searchParams.get("status")
                  : "idle",
            token: url.searchParams.get("token") || "",
            email: url.searchParams.get("email") || "",
            signupAllowed: config.signupAllowed,
            emailAvailable: Boolean(config.mail),
            user: session
              ? {
                  name: session.user.name,
                  email: session.user.email,
                  emailVerified: session.user.emailVerified,
                }
              : null,
          }),
          "text/html; charset=utf-8",
        );
      } catch {
        // Never log request paths, query strings, cookies, credentials or database errors.
        if (!res.headersSent)
          send(503, { error: "accounts_temporarily_unavailable" });
        else res.end();
      }
    },
  );
  server.keepAliveTimeout = 5_000;
  return server;
}
