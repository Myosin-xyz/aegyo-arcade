const API_ORIGIN = "https://api.mailjet.com";
const RESPONSE_LIMIT = 256 * 1024;

/** Read only the explicitly selected environment convention; never load .env. */
export function readMailjetPreflightConfig(env, source = "accounts") {
  const names =
    source === "accounts"
      ? ["MAILJET_API_KEY", "MAILJET_SECRET_KEY", "MAILJET_FROM_EMAIL"]
      : source === "aegyo"
        ? ["MJ_APIKEY_PUBLIC", "MJ_APIKEY_PRIVATE", "MAIL_FROM"]
        : null;
  if (!names) throw new Error("invalid_source");
  const [apiKey, secretKey, from] = names.map((name) => env[name]);
  if (
    [apiKey, secretKey, from].some(
      (value) => typeof value !== "string" || !value.trim(),
    )
  )
    throw new Error("missing_mail_configuration");
  if (
    !/^[^\s@<>:]+@[^\s@<>:]+\.[^\s@<>:]+$/.test(from) ||
    apiKey.includes(":") ||
    /[\r\n]/.test(apiKey + secretKey)
  )
    throw new Error("invalid_mail_configuration");
  return { apiKey, secretKey, from };
}

async function limitedJSON(response) {
  if (!response.body) throw new Error("empty_response");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > RESPONSE_LIMIT) throw new Error("oversized_response");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * One metadata GET scoped to the configured sender domain. No emails, contacts,
 * validations, DNS changes or account mutations. Provider bodies never escape.
 */
export async function inspectMailjetSender(config, transport = fetch) {
  const domain = config.from.split("@")[1].toLowerCase();
  const url = new URL("/v3/REST/sender", API_ORIGIN);
  url.searchParams.set("Domain", domain);
  url.searchParams.set("Limit", "100");
  url.searchParams.set("ShowDeleted", "false");
  const report = {
    checkedAt: new Date().toISOString(),
    configured: true,
    senderVerified: false,
    readyForDeliveryTest: false,
    deliveryVerified: false,
    capacityVerified: false,
    mutations: 0,
  };
  try {
    const response = await transport(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        accept: "application/json",
        authorization:
          "Basic " +
          Buffer.from(`${config.apiKey}:${config.secretKey}`).toString(
            "base64",
          ),
      },
    });
    report.httpStatus = response.status;
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { ...report, reason: "sender_api_rejected" };
    }
    const body = await limitedJSON(response);
    if (
      !Array.isArray(body.Data) ||
      body.Data.length > 100 ||
      !Number.isInteger(body.Count) ||
      body.Count !== body.Data.length ||
      !Number.isInteger(body.Total) ||
      body.Total < body.Count ||
      body.Total > body.Count
    )
      return { ...report, reason: "sender_response_incomplete" };
    const from = config.from.toLowerCase();
    const match = body.Data.find(
      (sender) =>
        sender &&
        sender.Status === "Active" &&
        typeof sender.Email === "string" &&
        [from, `*@${domain}`].includes(sender.Email.toLowerCase()),
    );
    if (!match) return { ...report, reason: "no_active_matching_sender" };
    return {
      ...report,
      senderVerified: true,
      readyForDeliveryTest: true,
      match: match.Email.startsWith("*@") ? "domain" : "address",
      reason: "sender_verified_delivery_and_capacity_unproven",
    };
  } catch {
    return { ...report, reason: "sender_check_failed" };
  }
}
