import { describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createCompetitionProfile, validateUsername } from "@/accounts/profile";

describe("competition username validation", () => {
  it.each(["abc", "fan_99", "abcdefghijklmnopqrst", "0_0"])(
    "accepts schema-compatible username %s",
    (username) =>
      expect(validateUsername(username)).toEqual({ ok: true, username }),
  );

  it.each([
    null,
    12,
    "ab",
    "abcdefghijklmnopqrstu",
    "Fan",
    "fan-name",
    " fan",
    "fán",
  ])("rejects malformed value %j without normalizing it", (username) => {
    expect(validateUsername(username)).toEqual({ ok: false, reason: "format" });
  });

  it.each(["admin", "aegyo", "moderator", "support", "system"])(
    "rejects reserved username %s",
    (username) =>
      expect(validateUsername(username)).toEqual({
        ok: false,
        reason: "reserved",
      }),
  );
});

describe("one-time competition profile assignment", () => {
  function fakeDb(results: Array<{ rows: Array<{ username: string }> }>): Db {
    return {
      execute: async () => results.shift() ?? { rows: [] },
    } as unknown as Db;
  }

  it("reports an atomic insert as created", async () => {
    const result = await createCompetitionProfile(
      fakeDb([{ rows: [{ username: "fan_99" }] }]),
      "00000000-0000-0000-0000-000000000001",
      "fan_99",
    );
    expect(result).toEqual({ kind: "created", username: "fan_99" });
  });

  it("makes a same-member same-name retry idempotent", async () => {
    const result = await createCompetitionProfile(
      fakeDb([{ rows: [] }, { rows: [{ username: "fan_99" }] }]),
      "00000000-0000-0000-0000-000000000001",
      "fan_99",
    );
    expect(result).toEqual({ kind: "existing", username: "fan_99" });
  });

  it("does not reassign a member who already chose another name", async () => {
    const result = await createCompetitionProfile(
      fakeDb([{ rows: [] }, { rows: [{ username: "first_name" }] }]),
      "00000000-0000-0000-0000-000000000001",
      "second_name",
    );
    expect(result).toEqual({
      kind: "member_already_named",
      username: "first_name",
    });
  });

  it("does not disclose the owner when another member holds a name", async () => {
    const result = await createCompetitionProfile(
      fakeDb([{ rows: [] }, { rows: [] }]),
      "00000000-0000-0000-0000-000000000001",
      "taken_name",
    );
    expect(result).toEqual({ kind: "username_unavailable" });
  });
});
