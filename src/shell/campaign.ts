/**
 * Allowlisted campaign attribution (TECH_SPEC OD-7, §17.2 "paid cohort",
 * M3 milestone row): UTM-style link parameters from the main-site link,
 * captured client-side for behavioral analytics ONLY. No shared person
 * identifier, no cookie, no server write.
 *
 * SESSION semantics follow §17.2 — a 30-minute inactivity window, NOT
 * tab lifetime (M3 review P1): attribution lives in a versioned
 * envelope with a last-activity timestamp; every capture touch extends
 * a live session (first touch wins inside it), and a landing after the
 * idle boundary starts a fresh session with fresh attribution.
 *
 * Everything not on the allowlist (names AND values) is stripped and
 * never stored or forwarded (§16 test requirement). URL cleanup removes
 * utm_* plus RECOGNIZED third-party click IDs (gclid, fbclid, …) — the
 * guarantee is "no known tracking residue", not "no residue of any
 * conceivable parameter".
 */

export const CAMPAIGN_STORAGE_KEY = "aa-campaign";

/** §17.2: provider-neutral 30-minute inactivity window. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;

/** Param NAME allowlist — anything else utm-like is stripped, not kept. */
export const ALLOWED_CAMPAIGN_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
] as const;

/**
 * Recognized third-party click identifiers: never stored (they are
 * person-linked identifiers — exactly what OD-7 excludes) and removed
 * from the address bar alongside utm_*.
 */
export const CLICK_ID_PARAMS = [
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "fbclid",
  "ttclid",
  "twclid",
  "msclkid",
  "igshid",
  "yclid",
] as const;

export type CampaignParam = (typeof ALLOWED_CAMPAIGN_PARAMS)[number];
export type Campaign = Partial<Record<CampaignParam, string>>;

interface CampaignEnvelope {
  v: 1;
  campaign: Campaign;
  lastActivityAt: number;
}

/**
 * Value allowlist: lowercase slug, 1–64 chars, must start alphanumeric.
 * Uppercase input is normalized before the check (campaign tooling is
 * case-sloppy); anything else — free-form text, URLs, separators — is
 * rejected so no unexpected value can reach analytics (§17.1: no
 * free-form data).
 */
const VALUE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function normalizeCampaignValue(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return VALUE_PATTERN.test(value) ? value : null;
}

/** Extract ONLY allowlisted, valid campaign fields from a query string. */
export function parseCampaign(search: string): Campaign {
  const params = new URLSearchParams(search);
  const campaign: Campaign = {};
  for (const name of ALLOWED_CAMPAIGN_PARAMS) {
    const raw = params.get(name);
    if (raw === null) continue;
    const value = normalizeCampaignValue(raw);
    if (value !== null) campaign[name] = value;
  }
  return campaign;
}

/**
 * Remove every `utm_*` parameter (allowlisted or not) AND every
 * recognized click ID from a URL so the address bar and any
 * copied/shared link carry no KNOWN tracking residue. All other
 * parameters are preserved verbatim. Returns null when there is nothing
 * to strip (callers skip the history rewrite).
 */
export function stripCampaignParams(url: URL): string | null {
  const clickIds = new Set<string>(CLICK_ID_PARAMS);
  const toDelete: string[] = [];
  for (const key of url.searchParams.keys()) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || clickIds.has(lower)) toDelete.push(key);
  }
  if (toDelete.length === 0) return null;
  const cleaned = new URL(url.href);
  for (const key of toDelete) cleaned.searchParams.delete(key);
  return cleaned.href;
}

function validateCampaign(value: unknown): Campaign {
  const campaign: Campaign = {};
  if (typeof value !== "object" || value === null) return campaign;
  for (const name of ALLOWED_CAMPAIGN_PARAMS) {
    const raw = (value as Record<string, unknown>)[name];
    if (typeof raw === "string") {
      const normalized = normalizeCampaignValue(raw);
      if (normalized !== null) campaign[name] = normalized;
    }
  }
  return campaign;
}

function clearResidue(): void {
  try {
    sessionStorage.removeItem(CAMPAIGN_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Live (non-idle-expired) envelope, or null. Hostile payloads are
 * re-validated field by field on every read, and expired/malformed
 * residue is CLEARED on read (M3 review P2 — reads alone must leave no
 * stale envelope behind). */
function readEnvelope(now: number): CampaignEnvelope | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(CAMPAIGN_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) throw new Error();
    const candidate = parsed as Record<string, unknown>;
    if (candidate.v !== 1) throw new Error();
    if (typeof candidate.lastActivityAt !== "number") throw new Error();
    if (now - candidate.lastActivityAt > SESSION_IDLE_MS) throw new Error();
    const campaign = validateCampaign(candidate.campaign);
    if (Object.keys(campaign).length === 0) throw new Error();
    return { v: 1, campaign, lastActivityAt: candidate.lastActivityAt };
  } catch {
    clearResidue();
    return null;
  }
}

function writeEnvelope(envelope: CampaignEnvelope): void {
  try {
    sessionStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Storage unavailable (private mode/quota) — attribution is lost,
    // gameplay unaffected.
  }
}

/**
 * Capture touchpoint (call on every page mount = activity):
 * - live session → FIRST touch wins; the touch extends the idle window;
 * - idle-expired or no session → a non-empty capture starts a NEW
 *   session with the new attribution (the 31-minute-later Instagram
 *   visit must not stay attributed to TikTok);
 * - nothing stored and nothing captured → stale residue is cleared.
 */
export function storeCampaign(campaign: Campaign, now = Date.now()): void {
  const live = readEnvelope(now);
  if (live !== null) {
    writeEnvelope({ ...live, lastActivityAt: now });
    return;
  }
  if (Object.keys(campaign).length > 0) {
    writeEnvelope({ v: 1, campaign, lastActivityAt: now });
  }
}

/**
 * Activity touch (client navigation, pointer, keyboard — throttled by
 * the caller): extends a LIVE session's idle window; never creates or
 * revives one. Production wiring lives in <CampaignCapture /> (M3
 * review P1: an actively playing user must not lose attribution at
 * wall-clock 30 minutes).
 */
export function touchCampaignSession(now = Date.now()): void {
  const live = readEnvelope(now);
  if (live !== null) writeEnvelope({ ...live, lastActivityAt: now });
}

/** The session's attribution for the (future) analytics sink — null
 * once the §17.2 idle window has lapsed. */
export function getStoredCampaign(now = Date.now()): Campaign | null {
  return readEnvelope(now)?.campaign ?? null;
}
