// Browser sign-out visits each first-party origin as a top-level navigation.
// Only these product identifiers and destinations are accepted; no URL from the
// request is ever used as a redirect target.
export const browserSignOutOrigins = Object.freeze({
  aegyo: "https://aegyoarena.com",
  arcade: "https://arcade.aegyoarena.com",
  daebak: "https://www.daebakmarkets.com",
});

export function browserSignOutNext(product) {
  if (!Object.hasOwn(browserSignOutOrigins, product)) return null;
  return `${browserSignOutOrigins.daebak}/browser-sign-out?return=${product}`;
}
