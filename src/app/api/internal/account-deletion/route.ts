import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  deletionAuthorized,
  deletionInput,
  deleteArcadeAccount,
} from "@/accounts/deletion";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: NextRequest) {
  if (!deletionAuthorized(request.headers.get("authorization")))
    return json({ error: "unauthorized" }, 401);
  try {
    const db = getDb();
    if (!db) throw new Error("unavailable");
    await db.execute(
      sql`SELECT request_id FROM account_deletion_receipts LIMIT 0`,
    );
    return json({ ready: true, version: 1, product: "arcade" });
  } catch {
    return json({ ready: false }, 503);
  }
}
export async function POST(request: NextRequest) {
  if (!deletionAuthorized(request.headers.get("authorization")))
    return json({ error: "unauthorized" }, 401);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "invalid_request" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        return json({ error: "request_too_large" }, 413);
      }
      chunks.push(value);
    }
    const input = deletionInput(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    if (!input) return json({ error: "invalid_request" }, 400);
    const db = getDb();
    if (!db) return json({ error: "unavailable" }, 503);
    try {
      return json(await deleteArcadeAccount(db, input));
    } catch (error) {
      if (error instanceof Error && error.message === "request_conflict")
        return json({ error: "request_conflict" }, 409);
      return json({ error: "deletion_retry_required" }, 503);
    }
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
}
