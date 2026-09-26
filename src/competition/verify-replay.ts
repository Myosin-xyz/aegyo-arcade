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
import {
  verifyCompetitionTrace as verifyCompetitionTraceV3,
  type CompetitionTraceV3,
  type ReplayResult as ReplayResultV3,
} from "./replay-v3";
import {
  verifyCompetitionTrace as verifyCompetitionTraceV4,
  type CompetitionTraceV4,
  type ReplayResultV4,
} from "./replay-v4";

export type CompetitionTrace =
  | CompetitionTraceV1
  | CompetitionTraceV2
  | CompetitionTraceV3
  | CompetitionTraceV4;
export type CompetitionReplayResult =
  ReplayResultV1 | ReplayResultV2 | ReplayResultV3 | ReplayResultV4;

/** Version dispatch stays outside every frozen verifier source closure. */
export function verifyCompetitionTrace(
  input: unknown,
): CompetitionReplayResult {
  if (
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    (input as { version?: unknown }).version === 4
  )
    return verifyCompetitionTraceV4(input);
  if (
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    (input as { version?: unknown }).version === 3
  ) {
    return verifyCompetitionTraceV3(input);
  }
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
