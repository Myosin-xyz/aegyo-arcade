import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("deletion confirmation works without AbortSignal.timeout and emits a receipt only after acceptance", async () => {
  let submit;
  const messages = [];
  const calls = [];
  const button = { disabled: false };
  const elements = Object.fromEntries(
    [
      "deletion-status",
      "deletion-form",
      "deletion-signin",
      "deletion-receipt",
      "deletion-manifest",
    ].map((id) => [id, { hidden: false, textContent: "" }]),
  );
  elements["deletion-form"].addEventListener = (_, fn) => {
    submit = fn;
  };
  elements["deletion-form"].querySelector = () => button;
  const context = {
    document: {
      body: { dataset: { locale: "en", enabled: "true" } },
      getElementById: (id) => elements[id],
    },
    window: {
      ReactNativeWebView: {
        postMessage: (message) => messages.push(JSON.parse(message)),
      },
    },
    AbortController,
    setTimeout: () => 1,
    clearTimeout: () => {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      return options.method === "POST"
        ? new Response(
            JSON.stringify({ requestId: "receipt", status: "processing" }),
          )
        : new Response("", { status: 404 });
    },
  };
  runInNewContext(
    readFileSync(new URL("./deletion.js", import.meta.url), "utf8"),
    context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.length, 0);
  await submit({ preventDefault() {} });
  assert.equal(messages[0].type, "aegyo-account-deletion");
  assert.equal(messages[0].status, "processing");
  assert.equal(elements["deletion-form"].hidden, true);
  assert.equal(button.disabled, false);
  assert.deepEqual(
    JSON.parse(calls.find((c) => c.options.method === "POST").options.body),
    { confirm: true, policyVersion: "2026-10-20.1" },
  );
  assert.match(elements["deletion-manifest"].textContent, /receipt/);
});

test("Spanish account keeps the deletion disclosure in Spanish", async () => {
  const { renderAccountPage } = await import("./pages.mjs");
  assert.match(
    renderAccountPage({
      page: "account",
      locale: "es",
      deletionEnabled: true,
      user: { name: "Fan", emailVerified: true },
    }),
    /href="\/delete-account\?lang=es">Eliminar cuenta/,
  );
});
