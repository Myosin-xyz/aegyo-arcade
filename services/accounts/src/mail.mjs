import { createHash } from "node:crypto";
import { standaloneVerificationURL } from "./verification-link.mjs";

const messages = {
  reset: {
    subject: "Reset your Aegyo Arena password",
    body: "Use this link to choose a new password. If you did not request this, you can ignore this email.",
  },
  verify: {
    subject: "Verify your email · Aegyo Arena",
    body: "Confirm your email to get the most out of Aegyo Arena.",
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
      const url =
        kind === "verify"
          ? standaloneVerificationURL(message.url, baseURL)
          : new URL(message.url);
      if (!copy || url.origin !== baseURL || url.username || url.password)
        throw new Error("Invalid account email");
      const text = `${copy.body}\n\n${kind === "verify" ? "Verify my email" : "Reset my password"}: ${url.href}\n\nIf you did not request this, you can ignore this email.\n\nAegyo Arena`;
      const html = brandedEmail(kind, url.href);
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
                  html,
                }
              : {
                  Messages: [
                    {
                      From: { Email: config.from, Name: "Aegyo Arena" },
                      To: [{ Email: message.user.email }],
                      Subject: copy.subject,
                      TextPart: text,
                      HTMLPart: html,
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

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function brandedEmail(kind, link) {
  const verify = kind === "verify";
  const title = verify ? "You’re one click away." : "Let’s get you back in.";
  const description = verify
    ? "Confirm your email to keep your Aegyo Arena account ready wherever you play."
    : "Choose a new password for your Aegyo Arena account.";
  const button = verify ? "Verify my email" : "Reset my password";
  const safeLink = escapeHTML(link);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${button} · Aegyo Arena</title></head><body style="margin:0;padding:0;background:#140a26;color:#f4ecff;font-family:Arial,Helvetica,sans-serif"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#140a26"><tr><td align="center" style="padding:32px 16px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;table-layout:fixed"><tr><td style="padding:4px 4px 22px;color:#ff8fb8;font-size:18px;font-weight:800;letter-spacing:1px">✦ AEGYO ARENA</td></tr><tr><td style="border:1px solid #523762;border-radius:20px;background:#21113a;padding:36px 30px"><p style="margin:0 0 12px;color:#2fe6c4;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase">YOUR ACCOUNT</p><h1 style="margin:0 0 16px;color:#ffffff;font-size:30px;line-height:1.2">${title}</h1><p style="margin:0 0 28px;color:#e0d1e8;font-size:16px;line-height:1.6">${description}</p><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#ff4f8b" style="border-radius:10px"><a href="${safeLink}" style="display:inline-block;padding:15px 24px;color:#240817;font-size:16px;font-weight:800;text-decoration:none">${button}</a></td></tr></table><p style="margin:28px 0 0;color:#b9a9c9;font-size:13px;line-height:1.5">If you didn’t request this, you can safely ignore this email.</p></td></tr><tr><td style="padding:22px 4px;color:#a993bc;font-size:12px;line-height:1.5;word-break:break-all">Aegyo Arena · Play. Return. Share.<br><span style="color:#c8bad8">If the button does not work, copy this link into your browser:</span><br><a href="${safeLink}" style="color:#ff8fb8;word-break:break-all">${safeLink}</a></td></tr></table></td></tr></table></body></html>`;
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
