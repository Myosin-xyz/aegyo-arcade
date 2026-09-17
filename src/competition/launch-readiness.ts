import type { PublicRoundRules, RoundRules } from "./rules";

export type MaterialLaunchBlocker =
  | "public_rules_url"
  | "sponsor"
  | "named_operator"
  | "approval_authority"
  | "eligibility_geography_age"
  | "prize_allocation"
  | "claim_deadline_fulfillment"
  | "full_arena_bonus"
  | "schedule"
  | "exact_tie_policy"
  | "engagement_sources";

const UNRESOLVED_TERM =
  /(?:\b(?:tbd|todo|pending|placeholder|unknown|unconfirmed)\b|\[[^\]]*(?:required|pending|tbd)[^\]]*\])/i;
const REQUIRED_PLACEHOLDER_PREFIX = /^required(?:\s*$|\s*[:._-])/i;

export function isResolvedCompetitionTerm(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 4 &&
    !UNRESOLVED_TERM.test(value) &&
    !REQUIRED_PLACEHOLDER_PREFIX.test(value.trim())
  );
}

function isPublicHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/**
 * Business terms that must be resolved before a material round can open.
 * Synthetic rounds intentionally have no material launch requirements.
 */
export function materialLaunchBlockers(
  rules: RoundRules | PublicRoundRules,
): MaterialLaunchBlocker[] {
  if (rules.mode !== "material_prize") return [];
  const approval = rules.approval;
  const blockers: MaterialLaunchBlocker[] = [];
  if (!isPublicHttpsUrl(rules.rulesUrl)) blockers.push("public_rules_url");
  if (!isResolvedCompetitionTerm(approval?.sponsor)) blockers.push("sponsor");
  if (!isResolvedCompetitionTerm(approval?.operator))
    blockers.push("named_operator");
  if (
    approval &&
    "approvedBy" in approval &&
    !isResolvedCompetitionTerm(
      (approval as { approvedBy?: unknown }).approvedBy,
    )
  )
    blockers.push("approval_authority");
  if (!isResolvedCompetitionTerm(approval?.eligibility))
    blockers.push("eligibility_geography_age");
  if (!isResolvedCompetitionTerm(approval?.prizes))
    blockers.push("prize_allocation");
  if (!isResolvedCompetitionTerm(approval?.claims))
    blockers.push("claim_deadline_fulfillment");
  if (rules.version === 2) {
    // The working public rules specify a 20-point Full Arena bonus. Keep
    // material rounds fail-closed until the configured value matches them.
    if (rules.scoring.fullArenaBonusPoints !== 20)
      blockers.push("full_arena_bonus");
    if (!isResolvedCompetitionTerm(approval?.schedule))
      blockers.push("schedule");
    if (!isResolvedCompetitionTerm(approval?.ties))
      blockers.push("exact_tie_policy");
    if (!isResolvedCompetitionTerm(approval?.engagementSources))
      blockers.push("engagement_sources");
  }
  return blockers;
}
