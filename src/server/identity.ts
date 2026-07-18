/**
 * Pseudonymous device identity (TECH_SPEC §8.1): 256-bit opaque token in a
 * host-only cookie; only the SHA-256 hash is stored; no device ID reaches
 * client JavaScript. Rolling 90-day retention (§9.5, counsel-reviewable).
 */

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { devices, deviceSessions } from "@/db/schema";
import { generateHandle } from "./handles";

export const SESSION_COOKIE = "__Host-aegyo_device";
export const SESSION_TTL_DAYS = 90;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Validate an IANA timezone; anything unsupported falls back to UTC. */
export function validateTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) {
    return "UTC";
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/**
 * Local-calendar day key for a device (OD-1): derived SERVER-side from the
 * persisted validated timezone. Single dayKey function for every feature.
 */
export function dayKeyFor(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at); // YYYY-MM-DD
}

export interface SessionDevice {
  deviceId: string;
  locale: string;
  handle: string | null;
  timeZone: string;
}

/** Resolve a session token to an active, non-tombstoned device. */
export async function resolveSession(
  db: Db,
  token: string,
): Promise<SessionDevice | null> {
  const tokenHash = hashToken(token);
  const rows = await db
    .select({
      deviceId: devices.id,
      locale: devices.locale,
      handle: devices.generatedHandle,
      timeZone: devices.timeZone,
      privacyState: devices.privacyState,
    })
    .from(deviceSessions)
    .innerJoin(devices, eq(deviceSessions.deviceId, devices.id))
    .where(
      and(
        eq(deviceSessions.tokenHash, tokenHash),
        isNull(deviceSessions.revokedAt),
        gt(deviceSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.privacyState !== "active") return null;
  return {
    deviceId: row.deviceId,
    locale: row.locale,
    handle: row.handle,
    timeZone: row.timeZone,
  };
}

export interface CreatedSession {
  token: string;
  device: SessionDevice;
}

/** Create a device + session; returns the raw token exactly once. */
export async function createDeviceSession(
  db: Db,
  options: { timeZone?: unknown; locale?: string } = {},
): Promise<CreatedSession> {
  const timeZone = validateTimeZone(options.timeZone);
  const handle = generateHandle();
  const token = newToken();
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  return db.transaction(async (tx) => {
    const [device] = await tx
      .insert(devices)
      .values({
        locale: options.locale ?? "en",
        generatedHandle: handle,
        timeZone,
      })
      .returning({ id: devices.id });
    await tx.insert(deviceSessions).values({
      tokenHash: hashToken(token),
      deviceId: device.id,
      expiresAt,
    });
    return {
      token,
      device: {
        deviceId: device.id,
        locale: options.locale ?? "en",
        handle,
        timeZone,
      },
    };
  });
}

/**
 * Touch activity for a ROLLING session (§8.1/§9.5): extends both the
 * session row and (via the returned expiry) the cookie — retention is
 * 90 days since last ACTIVITY, not since creation. Also persists a
 * validated timezone change, stamping `time_zone_changed_at` (OD-1).
 */
export async function touchSession(
  db: Db,
  token: string,
  device: SessionDevice,
  timeZone?: unknown,
): Promise<{ expiresAt: Date | null }> {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  return db.transaction(async (tx) => {
    // Same per-device advisory lock as gameplay/deletion, then re-check
    // liveness — a racing deletion must not receive activity/timezone
    // writes onto the tombstoned record (M1 review P2).
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${deviceLockKey(device.deviceId)}, 0))`,
    );
    const live = await tx
      .select({ privacyState: devices.privacyState })
      .from(devices)
      .where(eq(devices.id, device.deviceId))
      .for("update");
    const session = await tx
      .select({ revokedAt: deviceSessions.revokedAt })
      .from(deviceSessions)
      .where(eq(deviceSessions.tokenHash, hashToken(token)))
      .for("update");
    if (
      !live[0] ||
      live[0].privacyState !== "active" ||
      !session[0] ||
      session[0].revokedAt !== null
    ) {
      return { expiresAt: null }; // gone — caller treats as no session
    }

    const patch: {
      lastSeenAt: Date;
      timeZone?: string;
      timeZoneChangedAt?: Date;
    } = { lastSeenAt: now };
    if (timeZone !== undefined) {
      const validated = validateTimeZone(timeZone);
      if (validated !== device.timeZone) {
        patch.timeZone = validated;
        patch.timeZoneChangedAt = now;
      }
    }
    await tx.update(devices).set(patch).where(eq(devices.id, device.deviceId));
    await tx
      .update(deviceSessions)
      .set({ expiresAt })
      .where(eq(deviceSessions.tokenHash, hashToken(token)));
    return { expiresAt };
  });
}

/**
 * §8.1 deletion — atomic with gameplay: tombstone, revocation, and demo-row
 * deletion happen in the CALLER's single transaction under the same
 * per-device advisory lock gameplay takes (see privacy route + claw-play).
 */
export async function tombstoneDeviceTx(
  tx: Db,
  deviceId: string,
): Promise<void> {
  await tx
    .update(devices)
    .set({
      privacyState: "tombstoned",
      generatedHandle: null,
      avatarEmoji: null,
      timeZone: "UTC",
    })
    .where(eq(devices.id, deviceId));
  await tx
    .update(deviceSessions)
    .set({ revokedAt: new Date() })
    .where(eq(deviceSessions.deviceId, deviceId));
}

/** Advisory-lock key shared by every per-device mutation (claw, deletion). */
export function deviceLockKey(deviceId: string): string {
  return `device:${deviceId}`;
}

/**
 * Absolute UTC instant of the next local midnight in `timeZone` (OD-1
 * eligibility boundary). Two-pass offset resolution so DST transitions at
 * the target instant are handled.
 */
export function nextLocalMidnight(timeZone: string, at: Date): Date {
  const dayKey = dayKeyFor(timeZone, at); // YYYY-MM-DD local date
  const [y, m, d] = dayKey.split("-").map(Number);
  // First guess: next local midnight assuming the offset at `at`.
  const guessUtc = Date.UTC(y, m - 1, d + 1) - offsetMs(timeZone, at);
  // Second pass: recompute with the offset at the guessed instant (DST).
  const corrected =
    Date.UTC(y, m - 1, d + 1) - offsetMs(timeZone, new Date(guessUtc));
  return new Date(corrected);
}

function offsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
}
