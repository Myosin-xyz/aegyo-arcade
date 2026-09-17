import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTION_CLIENTS,
  validateManifest,
} from "../scripts/provision-production-clients-lib.mjs";
const manifest = {
  version: 1,
  clients: PRODUCTION_CLIENTS.map(
    ([key, redirectUri, postLogoutRedirectUri], i) => ({
      key,
      redirectUri,
      postLogoutRedirectUri,
      clientId: `first_party_client_${i}_abcdefgh`,
      clientSecret: `secret_${i}_${"x".repeat(40)}`,
    }),
  ),
};
test("accepts only the fixed three production callbacks and caller-owned credentials", () => {
  assert.equal(validateManifest(manifest).length, 3);
  for (const changed of [
    { ...manifest, clients: manifest.clients.slice(0, 2) },
    {
      ...manifest,
      clients: manifest.clients.map((x, i) =>
        i ? x : { ...x, redirectUri: "https://evil.example/callback" },
      ),
    },
    {
      ...manifest,
      clients: manifest.clients.map((x, i) =>
        i ? x : { ...x, clientSecret: "short" },
      ),
    },
  ])
    assert.throws(() => validateManifest(changed), /invalid_client_manifest/);
});
