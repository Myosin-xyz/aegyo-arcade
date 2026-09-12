export class ClientProvisionRefusal extends Error {}
const refuse = (code) => {
  throw new ClientProvisionRefusal(code);
};
export const PRODUCTION_CLIENTS = [
  [
    "aegyo",
    "https://aegyoarena.com/api/auth/shared/callback",
    "https://aegyoarena.com/",
  ],
  [
    "arcade",
    "https://arcade.aegyoarena.com/api/accounts/callback",
    "https://arcade.aegyoarena.com/",
  ],
  [
    "daebak",
    "https://www.daebakmarkets.com/api/accounts/callback",
    "https://www.daebakmarkets.com/",
  ],
];
export function validateManifest(input) {
  if (
    !input ||
    Object.keys(input).sort().join() !== "clients,version" ||
    input.version !== 1 ||
    !Array.isArray(input.clients) ||
    input.clients.length !== 3
  )
    refuse("invalid_client_manifest");
  return PRODUCTION_CLIENTS.map(
    ([key, redirectUri, postLogoutRedirectUri], index) => {
      const row = input.clients[index];
      if (
        !row ||
        Object.keys(row).sort().join() !==
          "clientId,clientSecret,key,postLogoutRedirectUri,redirectUri" ||
        row.key !== key ||
        row.redirectUri !== redirectUri ||
        row.postLogoutRedirectUri !== postLogoutRedirectUri ||
        !/^[A-Za-z0-9_-]{24,100}$/.test(row.clientId) ||
        typeof row.clientSecret !== "string" ||
        row.clientSecret.length < 32 ||
        row.clientSecret.length > 200
      )
        refuse("invalid_client_manifest");
      return row;
    },
  );
}
