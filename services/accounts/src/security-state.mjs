import { createHash, timingSafeEqual } from "node:crypto";

export function authorizedReader(header, readers) {
  if (
    typeof header !== "string" ||
    !header.startsWith("Bearer ") ||
    header.length > 1024
  )
    return false;
  const digest = (value) => createHash("sha256").update(value).digest();
  const presented = digest(header.slice(7));
  let valid = false;
  for (const key of Object.values(readers))
    valid = timingSafeEqual(presented, digest(key)) || valid;
  return valid;
}

export async function readSessionState(database, input) {
  if (
    !input ||
    typeof input.subject !== "string" ||
    typeof input.providerSessionId !== "string" ||
    !input.subject.length ||
    !input.providerSessionId.length ||
    input.subject.length > 200 ||
    input.providerSessionId.length > 200
  )
    return null;
  const { subject, providerSessionId } = input;
  const row = (
    await database.query(
      `SELECT u."passwordChangedAt", u."operatorRevokedAt", u."securityVersion",
    COALESCE(s.id IS NOT NULL AND s."expiresAt">now() AND NOT COALESCE(u.banned,false)
      AND s."credentialVersion"=u."credentialVersion" AND s."securityVersion"=u."securityVersion", false) AS active
    FROM public."user" u LEFT JOIN public."session" s ON s.id=$2 AND s."userId"=u.id WHERE u.id=$1`,
      [subject, providerSessionId],
    )
  ).rows[0];
  return {
    version: 1,
    subject,
    providerSessionId,
    active: row?.active === true,
    passwordResetState: {
      version: 1,
      kind: "database",
      lastPasswordReset: row?.passwordChangedAt?.toISOString() || null,
    },
    operatorCutoff: row?.operatorRevokedAt?.toISOString() || null,
    securityVersion: row?.securityVersion ?? 0,
  };
}

export async function checkDatabaseReadiness(database) {
  const result = await database.query(`SELECT
    (SELECT count(*) FROM public.aegyo_schema_version WHERE version=1) AS version,
    (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O'
      AND (tgname='aegyo_credential_changed' AND tgrelid='public.account'::regclass
        OR tgname='aegyo_session_credential_guard' AND tgrelid='public.session'::regclass)) AS guards,
    (SELECT rolsuper OR rolcreaterole OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS privileged,
    has_schema_privilege(current_user,'public','CREATE') AS can_create,
    has_column_privilege(current_user,'public.user','securityVersion','UPDATE') OR
    has_column_privilege(current_user,'public.user','credentialVersion','UPDATE') OR
    has_column_privilege(current_user,'public.user','passwordChangedAt','UPDATE') OR
    has_column_privilege(current_user,'public.user','operatorRevokedAt','UPDATE') OR
    has_column_privilege(current_user,'public.user','role','UPDATE') AS can_override,
    has_function_privilege(current_user,'public.aegyo_revoke_user(text,boolean)','EXECUTE') AS can_revoke`);
  const row = result.rows[0];
  return (
    Number(row.version) === 1 &&
    Number(row.guards) === 2 &&
    !row.privileged &&
    !row.can_create &&
    !row.can_override &&
    !row.can_revoke
  );
}
