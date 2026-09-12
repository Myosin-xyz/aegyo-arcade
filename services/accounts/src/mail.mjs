import { createHash } from "node:crypto";

const messages = {
  reset: {
    subject: "Reset your Aegyo Arena password",
    body: "Use this link to choose a new password. If you did not request this, you can ignore this email.",
  },
  verify: {
    subject: "Verify your Aegyo Arena email",
    body: "Use this link to verify your email address for Aegyo Arena.",
  },
};

export function createMailSender(config, baseURL, transport = fetch) {
  if (!config) return null;
  const provider = config.provider ?? "mailjet";
  if (!["mailjet", "resend"].includes(provider))
    throw new Error("Invalid account email provider");
  return async (kind, message) => {
    // Neither provider responses nor fetch errors may expose keys or reset links.
    try {
      const copy = messages[kind];
      const url = new URL(message.url);
      if (!copy || url.origin !== baseURL || url.username || url.password)
        throw new Error("Invalid account email");
      const text = `${copy.body}\n\n${url.href}\n\nAegyo Arena`;
      const resend = provider === "resend";
      const response = await transport(
        resend
          ? "https://api.resend.com/emails"
          : "https://api.mailjet.com/v3.1/send",
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
          headers: {
            "content-type": "application/json",
            authorization: resend
              ? `Bearer ${config.apiKey}`
              : "Basic " +
                Buffer.from(`${config.apiKey}:${config.secretKey}`).toString(
                  "base64",
                ),
            ...(resend
              ? {
                  "idempotency-key": `accounts-${kind}-${createHash("sha256")
                    .update(JSON.stringify([message.user.email, url.href]))
                    .digest("hex")}`,
                }
              : {}),
          },
          body: JSON.stringify(
            resend
              ? {
                  from: `Aegyo Arena <${config.from}>`,
                  to: [message.user.email],
                  subject: copy.subject,
                  text,
                }
              : {
                  Messages: [
                    {
                      From: { Email: config.from, Name: "Aegyo Arena" },
                      To: [{ Email: message.user.email }],
                      Subject: copy.subject,
                      TextPart: text,
                      CustomID: `accounts-${kind}`,
                    },
                  ],
                },
          ),
        },
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error("Account email delivery failed");
      }
      const result = await boundedJSON(response);
      const accepted = resend
        ? typeof result?.id === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            result.id,
          )
        : result?.Messages?.[0]?.Status === "success";
      if (!accepted) throw new Error("Account email delivery failed");
    } catch {
      throw new Error("Account email delivery failed");
    }
  };
}

async function boundedJSON(response) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64 * 1024) throw new Error("Email response too large");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
