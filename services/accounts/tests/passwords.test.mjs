import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { LEGACY_PREFIX, passwordFunctions } from "../src/passwords.mjs";

test("legacy SHA-256 accepts exact UTF-8 password plus explicit pepper", async () => {
  const pepper = "synthetic-pepper-사랑";
  const password = "Árbol-팬💜-123";
  const hash =
    LEGACY_PREFIX +
    createHash("sha256")
      .update(password + pepper)
      .digest("hex");
  const functions = passwordFunctions(pepper);
  assert.equal(await functions.verify({ password, hash }), true);
  assert.equal(
    await functions.verify({ password: password + " ", hash }),
    false,
  );
  assert.equal(
    await passwordFunctions("wrong").verify({ password, hash }),
    false,
  );
  assert.equal(
    await functions.verify({ password, hash: LEGACY_PREFIX + "broken" }),
    false,
  );
});

test("new credentials use the maintained scrypt implementation", async () => {
  const functions = passwordFunctions("synthetic-pepper");
  const password = "New-fixture-password-123";
  const hash = await functions.hash(password);
  assert.equal(hash.startsWith(LEGACY_PREFIX), false);
  assert.equal(await functions.verify({ password, hash }), true);
  assert.equal(await functions.verify({ password: "wrong", hash }), false);
  assert.equal(await functions.verify({ password, hash: "broken" }), false);
});

test("missing pepper never selects the legacy application's fallback secret", () => {
  for (const pepper of [undefined, null, ""]) {
    assert.throws(() => passwordFunctions(pepper), /explicit legacy pepper/);
  }
});
