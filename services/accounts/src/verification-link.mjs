const verificationPath = "/api/auth/verify-email";

export function verificationSuccessURL(baseURL) {
  return new URL("/verify-email?status=success", baseURL).href;
}

/** Keep verification independent of an OAuth transaction in another browser. */
export function standaloneVerificationURL(value, baseURL) {
  const url = new URL(value, baseURL);
  if (url.origin !== baseURL || url.pathname !== verificationPath)
    throw new Error("Invalid verification URL");
  url.searchParams.set("callbackURL", verificationSuccessURL(baseURL));
  return url;
}
