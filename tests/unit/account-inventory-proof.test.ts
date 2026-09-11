// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { collectInventory } from "../../scripts/auth-proof/inventory.mjs";

describe("read-only inventory boundaries", () => {
  it.each(["EventRegistration", "CommunityAnnotation"])(
    "flags a missing Aegyo runtime table %s even when core auth tables exist",
    async (missingTable) => {
      const names = [
        "User",
        "Session",
        "PasswordReset",
        "EventRegistration",
        "CommunityAnnotation",
      ];
      const query = vi.fn(async (sql: string) => {
        if (sql.includes("FROM pg_catalog.pg_class"))
          return {
            rows: names
              .filter((name) => name !== missingTable)
              .map((name, oid) => ({
                oid,
                name,
                can_read: true,
                row_security: false,
                force_row_security: false,
              })),
          };
        if (sql.startsWith("SELECT count(*)"))
          return { rows: [{ count: "0" }] };
        return { rows: [] };
      });
      const report = await collectInventory({ query }, "aegyo");
      expect(report.completeForExpectedTables).toBe(false);
      expect(report.missingExpectedTables).toEqual([missingTable]);
      expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    },
  );

  it("uses a consistent read-only snapshot and reads no individual rows", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM pg_catalog.pg_class"))
        return {
          rows: [
            {
              oid: 123,
              name: 'odd"name',
              row_security: false,
              force_row_security: false,
              can_read: true,
            },
          ],
        };
      if (sql.startsWith("SELECT count(*)")) return { rows: [{ count: "7" }] };
      return { rows: [] };
    });
    const report = await collectInventory({ query }, "arcade");
    expect(query.mock.calls[0][0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(query).toHaveBeenCalledWith(
      'SELECT count(*)::text AS count FROM public."odd""name"',
    );
    expect(report.completeForExpectedTables).toBe(false);
    expect(report.tables[0].count).toBe("7");
    expect(
      query.mock.calls.some(([sql]) => /SELECT\s+\*\s+FROM/i.test(sql)),
    ).toBe(false);
  });

  it("rolls back on timeout without claiming a partial inventory is complete", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM pg_catalog.pg_class"))
        throw new Error("statement timeout");
      return { rows: [] };
    });
    await expect(collectInventory({ query }, "daebak")).rejects.toThrow(
      "statement timeout",
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
});
