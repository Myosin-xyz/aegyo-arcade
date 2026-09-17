import { NextRequest } from "next/server";
import { memberContext } from "./http";
import { CompetitionError } from "./rules";

type Environment = Readonly<Record<string, string | undefined>>;

const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export function competitionOperatorSubjects(
  env: Environment = process.env,
): Set<string> | null {
  const raw = env.ARCADE_COMPETITION_OPERATOR_SUBJECTS;
  if (!raw) return null;
  const values = raw.split(",").map((value) => value.trim());
  if (
    values.length === 0 ||
    values.length > 20 ||
    values.some((value) => !SUBJECT.test(value)) ||
    new Set(values).size !== values.length
  )
    return null;
  return new Set(values);
}

export function isCompetitionOperator(
  subject: string,
  env: Environment = process.env,
): boolean {
  return competitionOperatorSubjects(env)?.has(subject) === true;
}

export async function competitionOperatorContext(
  request: NextRequest,
  options: { mutation?: boolean } = {},
) {
  const allowed = competitionOperatorSubjects();
  if (!allowed)
    throw new CompetitionError("operator_access_not_configured", 503);
  const context = await memberContext(request, {
    mutation: options.mutation === true,
  });
  if (!context.session.emailVerified || !allowed.has(context.session.subject))
    throw new CompetitionError("operator_access_required", 403);
  return {
    ...context,
    actor: `accounts:${context.session.subject}`,
  };
}
