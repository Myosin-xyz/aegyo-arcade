/**
 * Staging candidate: attach current reset state for server adapter enforcement.
 * Central timestamp enforcement is intentionally pending T28: do not assume
 * event.authentication.methods supplies auth_time-equivalent timestamps.
 * Deploy only to the approved staging tenant after configuring all client IDs.
 */
const CLAIM = "https://aegyoarena.com/claims/password-reset-state";

exports.onExecutePostLogin = async (event, api) => {
  const clientIds = [
    event.secrets?.AEGYO_CLIENT_ID,
    event.secrets?.ARCADE_CLIENT_ID,
    event.secrets?.DAEBAK_CLIENT_ID,
  ];
  if (clientIds.some((id) => typeof id !== "string" || id.length === 0)) {
    api.access.deny("Account sign-in configuration is incomplete.");
    return;
  }
  if (!clientIds.includes(event.client?.client_id)) {
    api.access.deny("This application is not configured for shared sign-in.");
    return;
  }
  if (event.connection?.strategy !== "auth0") {
    api.idToken.setCustomClaim(CLAIM, { version: 1, kind: "unsupported" });
    return;
  }
  if (
    !event.user ||
    typeof event.user !== "object" ||
    Array.isArray(event.user)
  ) {
    api.access.deny("Account freshness could not be established.");
    return;
  }
  const reset = event.user.last_password_reset;
  if (
    reset !== undefined &&
    (typeof reset !== "string" || !Number.isFinite(Date.parse(reset)))
  ) {
    api.access.deny("Account freshness could not be established.");
    return;
  }
  api.idToken.setCustomClaim(CLAIM, {
    version: 1,
    kind: "database",
    lastPasswordReset: reset ?? null,
  });
};
