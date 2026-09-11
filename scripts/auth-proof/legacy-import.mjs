import { createHash } from "node:crypto";

/** Pure conversion only. No database writes, provider calls, or fallback salt. */
export function buildLegacyImport(rows, legacySalt) {
  if (typeof legacySalt !== "string") {
    throw new Error("Explicitly verified legacy salt is required");
  }
  if (!Array.isArray(rows)) throw new Error("Expected legacy user array");
  const ids = new Set();
  const emails = new Set();
  return rows.map((row) => {
    if (
      !row ||
      typeof row.id !== "string" ||
      !/^c[a-z0-9]{24}$/.test(row.id) ||
      typeof row.email !== "string" ||
      row.email.trim() !== row.email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) ||
      typeof row.emailVerified !== "boolean" ||
      typeof row.passwordHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.passwordHash)
    ) {
      // Never include a row, email, credential or hash in diagnostics.
      throw new Error("Legacy row needs manual migration review");
    }
    const normalizedEmail = row.email.toLowerCase();
    if (ids.has(row.id) || emails.has(normalizedEmail)) {
      throw new Error(
        "Duplicate identity requires reconciliation before import",
      );
    }
    ids.add(row.id);
    emails.add(normalizedEmail);
    return {
      user_id: row.id,
      email: row.email,
      email_verified: row.emailVerified,
      custom_password_hash: {
        algorithm: "sha256",
        hash: { value: row.passwordHash, encoding: "hex" },
        salt: { value: legacySalt, encoding: "utf8", position: "suffix" },
        password: { encoding: "utf8" },
      },
      // Local IDs own role/content/consent data; these are not email-matched.
      app_metadata: { legacy_aegyo_user_id: row.id },
    };
  });
}

/** Synthetic-only fixture, independent of all real environment credentials. */
export function syntheticImportFixture() {
  const salt = "aegyo-proof-salt-ñ-팬";
  const cases = [
    { id: "c" + "a".repeat(24), password: "Proof-only-Hello-123!" },
    { id: "c" + "b".repeat(24), password: "Prueba-팬-ñ-🔐-123!" },
  ];
  const rows = cases.map(({ id, password }, index) => ({
    id,
    email: `auth-proof-${index + 1}@example.invalid`,
    emailVerified: false,
    passwordHash: createHash("sha256")
      .update(password + salt)
      .digest("hex"),
  }));
  return { cases, rows, salt, users: buildLegacyImport(rows, salt) };
}
