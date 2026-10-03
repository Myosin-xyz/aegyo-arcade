import assert from "node:assert/strict";
import test from "node:test";
import { browserSignOutNext } from "../src/browser-sign-out.mjs";
import { renderAccountPage } from "../ui/pages.mjs";

test("browser sign-out accepts only named first-party return destinations", () => {
  assert.equal(
    browserSignOutNext("arcade"),
    "https://www.daebakmarkets.com/browser-sign-out?return=arcade",
  );
  assert.equal(browserSignOutNext("https://attacker.example"), null);
  assert.equal(browserSignOutNext("__proto__"), null);
});

test("browser sign-out page starts a local POST before navigating", () => {
  const html = renderAccountPage({
    page: "sign-out",
    logoutNext: browserSignOutNext("aegyo"),
    logoutReturn: "aegyo",
  });
  assert.match(html, /data-auth-form="sign-out" data-auto-submit/);
  assert.match(
    html,
    /data-logout-next="https:\/\/www\.daebakmarkets\.com\/browser-sign-out\?return=aegyo"/,
  );
  assert.doesNotMatch(html, /<script(?![^>]*src=)/);
  assert.match(html, /href="\?lang=es&amp;return=aegyo"/);
  assert.match(html, /data-browser-logout-enabled="false"/);
});

test("ordinary account pages opt into browser-wide sign-out only explicitly", () => {
  const ordinary = renderAccountPage({ page: "account", user: {} });
  const production = renderAccountPage({
    page: "account",
    user: {},
    browserLogoutEnabled: true,
  });
  assert.match(ordinary, /data-browser-logout-enabled="false"/);
  assert.match(production, /data-browser-logout-enabled="true"/);
});
