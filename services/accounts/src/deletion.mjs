import { createHash, randomBytes, randomUUID } from "node:crypto";

export const DELETION_COOKIE = "__Host-aegyo_deletion";
export const DELETION_POLICY_VERSION = "2026-10-20.1";
const PRODUCTS = ["social", "arcade", "daebak"];
const digest = (token) => createHash("sha256").update(token).digest("hex");

export function deletionConfig(env, baseURL) {
  if (env.ACCOUNTS_DELETION_ENABLED !== "true") return null;
  const raw = JSON.parse(env.ACCOUNTS_DELETION_PARTICIPANTS_JSON || "null");
  if (!raw || Object.keys(raw).sort().join() !== [...PRODUCTS].sort().join())
    throw new Error("Deletion requires all three participants");
  for (const value of Object.values(raw)) {
    const url = new URL(value.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/api/internal/account-deletion" ||
      typeof value.key !== "string" ||
      value.key.length < 32
    )
      throw new Error("Invalid deletion participant");
  }
  if (new Set(Object.values(raw).map((p) => p.key)).size !== PRODUCTS.length)
    throw new Error("Deletion participants require separate keys");
  return { participants: raw, issuer: `${baseURL}/api/auth` };
}

export async function preflightDeletion(database, config, transport = fetch) {
  if (!config) throw new Error("deletion_unavailable");
  await database.query("SELECT id FROM account_deletion.jobs LIMIT 0");
  for (const product of PRODUCTS) {
    const participant = config.participants[product];
    const response = await transport(participant.url, {
      headers: { Authorization: `Bearer ${participant.key}` },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    const payload = response.ok ? await response.json() : null;
    if (
      payload?.ready !== true ||
      payload?.version !== 1 ||
      payload?.product !== product
    )
      throw new Error("deletion_unavailable");
  }
}

export async function beginDeletion(database, session) {
  if (!session?.user?.id || !session?.session?.id)
    throw new Error("deletion_session_required");
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await database.query(
    "SELECT account_deletion.begin_request($1,$2,$3::uuid,$4)",
    [session.user.id, session.session.id, id, digest(token)],
  );
  return { id, token };
}

export function receiptToken(cookie) {
  const token = cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${DELETION_COOKIE}=`))
    ?.slice(DELETION_COOKIE.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export async function deletionReceipt(database, token) {
  if (!token) return null;
  const result = await database.query(
    "SELECT id,status,manifest,policy_version,created_at,completed_at FROM account_deletion.jobs WHERE receipt_hash=$1",
    [digest(token)],
  );
  const row = result.rows[0];
  return row
    ? {
        requestId: row.id,
        status: row.status,
        manifest: row.manifest,
        policyVersion: row.policy_version,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      }
    : null;
}

/** Durable claims survive crashes; participant receipts make replay after a lost response safe. */
export async function processDeletion(database, config, transport = fetch) {
  if (!config) return false;
  const claimed = await database.query(`UPDATE account_deletion.jobs SET
      lease_until=now()+interval '2 minutes',attempts=attempts+1
    WHERE id=(SELECT id FROM account_deletion.jobs WHERE status='processing'
      AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now())
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id,subject,manifest`);
  const job = claimed.rows[0];
  if (!job) return false;
  let conflict = false;
  try {
    for (const product of PRODUCTS) {
      if (job.manifest[product]?.status === "blocked") {
        conflict = true;
        continue;
      }
      if (
        ["completed", "no_link", "needs_review"].includes(
          job.manifest[product]?.status,
        )
      )
        continue;
      const participant = config.participants[product];
      const response = await transport(participant.url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${participant.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: job.id,
          issuer: config.issuer,
          subject: job.subject,
        }),
      });
      if (response.status === 409) {
        conflict = true;
        await database.query(
          "UPDATE account_deletion.jobs SET manifest=jsonb_set(manifest,ARRAY[$2::text],$3::jsonb) WHERE id=$1::uuid",
          [
            job.id,
            product,
            JSON.stringify({ status: "blocked", reason: "request_conflict" }),
          ],
        );
        continue;
      }
      const payload = response.ok ? await response.json() : null;
      if (
        !payload ||
        payload.requestId !== job.id ||
        !["completed", "no_link", "needs_review"].includes(payload.status)
      )
        throw new Error("participant_unavailable");
      // Participants return category/count manifests, never raw user content or credentials.
      if (JSON.stringify(payload).length > 16_384)
        throw new Error("invalid_manifest");
      await database.query(
        "UPDATE account_deletion.jobs SET manifest=jsonb_set(manifest,ARRAY[$2::text],$3::jsonb) WHERE id=$1::uuid",
        [job.id, product, JSON.stringify(payload)],
      );
    }
    if (conflict) {
      await database.query(
        "UPDATE account_deletion.jobs SET lease_until=NULL,last_error='participant_conflict',next_attempt_at='infinity' WHERE id=$1::uuid",
        [job.id],
      );
      return true;
    }
    await database.query("SELECT account_deletion.finish_request($1::uuid)", [
      job.id,
    ]);
  } catch {
    // No raw network/database errors: these can contain sensitive identifiers and service URLs.
    await database.query(
      `UPDATE account_deletion.jobs SET lease_until=NULL,last_error='retry_pending',
      next_attempt_at=now()+interval '1 minute' WHERE id=$1::uuid`,
      [job.id],
    );
  }
  return true;
}
