// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { competitionOperatorDashboard } from "@/competition/operator-dashboard";

describe("competition operator dashboard", () => {
  it("uses the database clock for lifecycle controls", async () => {
    const databaseNow = new Date("2031-04-05T06:07:08.000Z");
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ server_now: databaseNow }] });

    await expect(
      competitionOperatorDashboard({ execute } as unknown as Db),
    ).resolves.toEqual({
      serverNow: databaseNow.toISOString(),
      rounds: [],
      selected: null,
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
