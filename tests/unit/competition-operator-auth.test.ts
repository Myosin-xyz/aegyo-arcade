// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  competitionOperatorSubjects,
  isCompetitionOperator,
} from "@/competition/operator-auth";

describe("competition operator allowlist", () => {
  it("matches only an exact configured Accounts subject", () => {
    const env = {
      ARCADE_COMPETITION_OPERATOR_SUBJECTS: "user_1,user-2:owner",
    };
    expect([...competitionOperatorSubjects(env)!]).toEqual([
      "user_1",
      "user-2:owner",
    ]);
    expect(isCompetitionOperator("user_1", env)).toBe(true);
    expect(isCompetitionOperator("USER_1", env)).toBe(false);
    expect(isCompetitionOperator("user", env)).toBe(false);
  });

  it.each([
    undefined,
    "",
    "user_1,user_1",
    "user_1,",
    "user 1",
    "x".repeat(201),
  ])("fails closed for invalid configuration %j", (value) => {
    expect(
      competitionOperatorSubjects({
        ARCADE_COMPETITION_OPERATOR_SUBJECTS: value,
      }),
    ).toBeNull();
  });
});
