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
  return async (kind, message) => {
    const copy = messages[kind];
    const url = new URL(message.url);
    if (!copy || url.origin !== baseURL)
      throw new Error("Invalid account email");
    const response = await transport("https://api.mailjet.com/v3.1/send", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json",
        authorization:
          "Basic " +
          Buffer.from(`${config.apiKey}:${config.secretKey}`).toString(
            "base64",
          ),
      },
      body: JSON.stringify({
        Messages: [
          {
            From: { Email: config.from, Name: "Aegyo Arena" },
            To: [{ Email: message.user.email }],
            Subject: copy.subject,
            TextPart: `${copy.body}\n\n${url.href}\n\nAegyo Arena`,
            CustomID: `accounts-${kind}`,
          },
        ],
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.Messages?.[0]?.Status !== "success")
      throw new Error("Account email delivery failed");
  };
}
