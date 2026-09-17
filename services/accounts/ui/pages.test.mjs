import assert from "node:assert/strict";
import test from "node:test";
import { renderAccountPage } from "./pages.mjs";

function decodeAttribute(value) {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"');
}

test("unverified members can reach verification without losing the authorization journey", () => {
  const continuationUrl =
    "https://account.aegyoarena.com/api/auth/oauth2/authorize?state=opaque&sig=signed";
  const html = renderAccountPage({
    page: "account",
    user: {
      name: "Member",
      email: "member@example.invalid",
      emailVerified: false,
    },
    continuationUrl,
  });
  const href = decodeAttribute(html.match(/href="([^"]+)">Verify email/)[1]);
  const url = new URL(href, "https://account.aegyoarena.com");
  assert.equal(url.pathname, "/verify-email");
  assert.equal(url.searchParams.get("continue"), continuationUrl);
  assert.equal(url.searchParams.has("email"), false);
  const verified = renderAccountPage({
    page: "account",
    user: { emailVerified: true },
    continuationUrl,
  });
  assert.doesNotMatch(verified, /href="[^\"]+">Verify email/);
});

test("sign-up and language links preserve the exact signed authorization journey", () => {
  const oauthQuery =
    "client_id=arcade&redirect_uri=https%3A%2F%2Farcade.aegyoarena.com%2Fapi%2Faccounts%2Fcallback&max_age=0&state=a%2Bb&sig=signed";
  const continuationUrl = `https://account.aegyoarena.com/api/auth/oauth2/authorize?${oauthQuery}`;
  const html = renderAccountPage({
    page: "sign-in",
    oauthQuery,
    continuationUrl,
  });
  const signupHref = decodeAttribute(
    html.match(/href="([^"]+)">Create one/)[1],
  );
  const languageHref = decodeAttribute(
    html.match(/href="([^"]+)" hreflang="es"/)[1],
  );
  assert.equal(
    new URL(signupHref, "https://account.aegyoarena.com").searchParams.get(
      "continue",
    ),
    continuationUrl,
  );
  assert.equal(
    new URL(languageHref, "https://account.aegyoarena.com").searchParams.get(
      "continue",
    ),
    continuationUrl,
  );
  assert.ok(
    html.includes(`data-oauth-query="${oauthQuery.replaceAll("&", "&amp;")}"`),
  );
});

test("locale toggle retains reset token only on the token-bearing page", () => {
  const reset = renderAccountPage({
    page: "reset-password",
    token: "secret-token",
  });
  const resetLanguageHref = decodeAttribute(
    reset.match(/href="([^"]+)" hreflang="es"/)[1],
  );
  assert.equal(
    new URL(
      resetLanguageHref,
      "https://account.aegyoarena.com",
    ).searchParams.get("token"),
    "secret-token",
  );
  assert.doesNotMatch(reset, /href="\/sign-in\?[^\"]*token=/);

  const signIn = renderAccountPage({
    page: "sign-in",
    token: "must-not-travel",
  });
  const signInLanguageHref = decodeAttribute(
    signIn.match(/href="([^"]+)" hreflang="es"/)[1],
  );
  assert.equal(
    new URL(
      signInLanguageHref,
      "https://account.aegyoarena.com",
    ).searchParams.has("token"),
    false,
  );
});
