import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function navigation({ oauthQuery = "signed=1", trustedRedirectUri = "" } = {}) {
  const context = {
    URL,
    URLSearchParams,
    FormData,
    document: {
      body: {
        dataset: {
          continuation: "/api/auth/oauth2/authorize?max_age=0&sig=signed",
          oauthQuery,
          trustedRedirectUri,
          testHooks: "true",
        },
      },
      addEventListener() {},
      querySelector() {
        return null;
      },
    },
    location: { origin: "https://account.aegyoarena.com" },
  };
  context.globalThis = context;
  vm.runInNewContext(
    readFileSync(new URL("./accounts.js", import.meta.url), "utf8"),
    context,
  );
  return context.__accountsNavigation;
}

test("accepts only the exact registered external callback with code and state", () => {
  const nav = navigation({
    trustedRedirectUri: "https://arcade.aegyoarena.com/auth/callback",
  });
  const valid =
    "https://arcade.aegyoarena.com/auth/callback?code=abc&state=opaque&iss=https%3A%2F%2Faccount.aegyoarena.com";
  assert.equal(nav.providerDestination(valid), valid);
  assert.equal(
    nav.providerDestination(
      "https://arcade.aegyoarena.com/other?code=abc&state=opaque",
    ),
    "",
  );
  assert.equal(
    nav.providerDestination(
      "https://evil.example/auth/callback?code=abc&state=opaque",
    ),
    "",
  );
  assert.equal(
    nav.providerDestination(
      "https://arcade.aegyoarena.com/auth/callback?code=abc",
    ),
    "",
  );
});

test("rejects unregistered external redirects by default", () => {
  const nav = navigation();
  assert.equal(
    nav.providerDestination(
      "https://arcade.aegyoarena.com/auth/callback?code=abc&state=opaque",
    ),
    "",
  );
});

test("does not replay the signed authorize request after OAuth sign-in", () => {
  const nav = navigation();
  assert.equal(
    nav.providerDestination(
      "https://account.aegyoarena.com/api/auth/oauth2/authorize?max_age=0&sig=signed",
    ),
    "",
  );
  assert.equal(
    nav.postAuthDestination(
      "https://account.aegyoarena.com/api/auth/oauth2/authorize?max_age=0&sig=signed",
    ),
    "/account",
  );
  assert.equal(
    nav.providerDestination("https://account.aegyoarena.com/account"),
    "https://account.aegyoarena.com/account",
  );
});

test("chooses a validated provider callback over the original authorize continuation", () => {
  const nav = navigation({
    trustedRedirectUri: "https://arcade.aegyoarena.com/auth/callback",
  });
  const callback =
    "https://arcade.aegyoarena.com/auth/callback?code=abc&state=opaque";
  assert.equal(nav.postAuthDestination(callback), callback);
  assert.equal(
    nav.postAuthDestination(
      "https://evil.example/auth/callback?code=abc&state=opaque",
    ),
    "/account",
  );
});
