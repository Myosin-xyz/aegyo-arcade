// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildLegacyImport,
  syntheticImportFixture,
} from "../../scripts/auth-proof/legacy-import.mjs";

describe("Aegyo import conversion (offline, not an Auth0 import)", () => {
  it("matches SHA-256 UTF-8 password + suffix salt including non-ASCII bytes", () => {
    const fixture = syntheticImportFixture();
    fixture.users.forEach((user, index) => {
      const imported = user.custom_password_hash;
      // Independently interpret the provider fields, rather than reuse the
      // source concatenation, to catch wrong salt position/encoding.
      const passwordBytes = Buffer.from(fixture.cases[index].password, "utf8");
      const saltBytes = Buffer.from(imported.salt.value, "utf8");
      const hash = createHash("sha256")
        .update(Buffer.concat([passwordBytes, saltBytes]))
        .digest("hex");
      expect(imported.algorithm).toBe("sha256");
      expect(imported.salt.position).toBe("suffix");
      expect(imported.salt.encoding).toBe("utf8");
      expect(imported.hash.encoding).toBe("hex");
      expect(imported.hash.value).toBe(hash);
      expect(
        createHash("sha256")
          .update(Buffer.concat([saltBytes, passwordBytes]))
          .digest("hex"),
      ).not.toBe(hash);
    });
  });

  it("retains local IDs and verification flags without importing roles/consent", () => {
    const fixture = syntheticImportFixture();
    const snapshot = structuredClone(fixture.rows);
    const users = buildLegacyImport(fixture.rows, fixture.salt);
    users.forEach((user, index) => {
      expect(user.user_id).toBe(snapshot[index].id);
      expect(user.app_metadata.legacy_aegyo_user_id).toBe(snapshot[index].id);
      expect(user.email_verified).toBe(false);
      expect(user).not.toHaveProperty("username");
      expect(user).not.toHaveProperty("user_metadata");
      expect(user.app_metadata).not.toHaveProperty("role");
    });
    expect(fixture.rows).toEqual(snapshot);
  });

  it("never guesses the legacy salt", () => {
    expect(() =>
      buildLegacyImport(syntheticImportFixture().rows, undefined),
    ).toThrow("Explicitly verified");
  });

  it("rejects case-insensitive email collisions without silently merging", () => {
    const { rows, salt } = syntheticImportFixture();
    rows[1].email = rows[0].email.toUpperCase();
    expect(() => buildLegacyImport(rows, salt)).toThrow("Duplicate identity");
  });

  it("rejects duplicate IDs", () => {
    const { rows, salt } = syntheticImportFixture();
    rows[1].id = rows[0].id;
    expect(() => buildLegacyImport(rows, salt)).toThrow("Duplicate identity");
  });

  it("rejects unusable sentinels and unexpected IDs with redacted diagnostics", () => {
    const { rows, salt } = syntheticImportFixture();
    rows[0].passwordHash = "unusable-external-user";
    expect(() => buildLegacyImport(rows, salt)).toThrow(
      "manual migration review",
    );
    try {
      buildLegacyImport(rows, salt);
    } catch (error) {
      expect(String(error)).not.toContain(rows[0].email);
      expect(String(error)).not.toContain(rows[0].passwordHash);
    }
  });
});
