export const MEMBER_COOKIE = "__Host-aegyo_member";
export const OIDC_TRANSACTION_COOKIE = "__Host-aegyo_oidc_tx";

export const SECURE_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};
