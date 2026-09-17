import {
  verifyCompetitionTrace as verifyCompetitionTraceV1,
  type CompetitionTraceV1,
  type ReplayResult as ReplayResultV1,
} from "./replay";
import {
  verifyCompetitionTrace as verifyCompetitionTraceV2,
  type CompetitionTraceV2,
  type ReplayResult as ReplayResultV2,
} from "./replay-v2";

export type CompetitionTrace = CompetitionTraceV1 | CompetitionTraceV2;
export type CompetitionReplayResult = ReplayResultV1 | ReplayResultV2;

/** Version dispatch stays outside every frozen verifier source closure. */
export function verifyCompetitionTrace(
  input: unknown,
): CompetitionReplayResult {
  if (
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    (input as { version?: unknown }).version === 2
  ) {
    return verifyCompetitionTraceV2(input);
  }
  return verifyCompetitionTraceV1(input);
}
