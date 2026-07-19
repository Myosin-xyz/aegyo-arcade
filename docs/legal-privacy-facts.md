# Privacy Facts — EXT-LEGAL counsel briefing (Aegyo Arcade)

> Prepared 2026-07-19 to accelerate the EXT-LEGAL gate (TECH_SPEC §3.1):
> counsel confirms audience classification, privacy/consent posture,
> notice text, and retention. This is the FACTUAL inventory; the legal
> conclusions are counsel's.

## What the product is

Free K-pop mini-game PWA (arcade.aegyoarena.com planned). No accounts,
no purchases, no prizes at launch (cosmetic weekly leaderboards only —
adopted default OD-3). Audience skews young K-pop fans, ~95% mobile,
primarily Latin America; Spanish (es-419) + English shipped.

## Data inventory

| Data                                                                         | Where                                         | Purpose                                       | Notes                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| Pseudonymous device ID (server-generated UUID)                               | Postgres `devices`                            | Ties runs/streaks/boards to a device          | No name, email, phone, or account anywhere                         |
| Generated handle (e.g. "SunnyPhotocard97")                                   | `devices`                                     | Leaderboard display name                      | Server-curated wordlist; no free-text identity (META-3)            |
| IANA timezone string                                                         | `devices`                                     | Player-local daily-run window (OD-1)          | Updated on change, timestamped                                     |
| Locale ("en"/"es-419")                                                       | `devices`                                     | Language preference                           | Allowlisted values only                                            |
| Session token (hashed at rest)                                               | `device_sessions` + HttpOnly host-only cookie | Session continuity                            | 90-day rolling expiry from last activity                           |
| Daily play-slot bookkeeping (player-local day key, completion link)          | `daily_slots`                                 | One counted run per player-local day (OD-1)   | Day key derives from the stored timezone; no location              |
| Run attempts (game id, server-issued seed, score, client-reported duration)  | `run_attempts`                                | Counted-run integrity + idempotent replays    | Result snapshot retained so replays return the original result     |
| Board / streak rows (score, season key, streak counters)                     | `leaderboard_scores`, `streaks`               | Gameplay features                             | Weekly boards show handle + score                                  |
| Claw plays (client-generated idempotency key, server-drawn outcome, ordinal) | `claw_plays`                                  | Idempotent claw outcomes                      | Key is a random client UUID, not person-linked                     |
| Prize claim rows (claim state per winning play)                              | `prize_claims`                                | Claw prize bookkeeping                        | No prizes at launch; empty in practice                             |
| Analytics outbox (event name + coarse payload, e.g. score buckets)           | `analytics_outbox`                            | Written transactionally for a FUTURE provider | No provider is integrated; rows are never published anywhere today |
| Ops audit rows (promotion activations, actor)                                | `ops_audit`                                   | Operator accountability                       | Internal only                                                      |

Explicitly NOT collected: names, emails, phone numbers, contacts,
precise location (timezone only), IP retention in app tables, photos,
free-text input of any kind, third-party identity.

## Client-side storage

- HttpOnly session cookie (host-only)
- `localStorage`: mute flag, locale preference
- `sessionStorage`: campaign attribution (allowlisted utm_source /
  utm_medium / utm_campaign, 30-min inactivity window, first-touch;
  gclid/fbclid & co. are STRIPPED and never stored — OD-7 prohibits
  person-linked identifiers)

## Third parties

- Hosting: Vercel (app), Railway (Postgres). Their infrastructure
  logs (request logs, database logs) are retained per each provider's
  own policy and can transiently include IP addresses; no IPs are
  written to application tables.
- NO analytics provider is integrated (provider selection, region,
  retention, DPA, consent mode are explicitly EXT-LEGAL decisions —
  TECH_SPEC §17.2). No ad SDKs, no social SDKs, no fonts/CDN calls at
  runtime (fonts are self-hosted via the build).

## Deletion & retention

Implemented today:

- User-invoked deletion (TECH_SPEC §8.1): the device record is
  tombstoned (handle and avatar removed, timezone reset) and all
  sessions revoked atomically. Gameplay history rows (scores, runs,
  streaks) are RETAINED and remain mutually linked through the
  persistent device UUID — this is **pseudonymized retained history
  with the public handle removed, not full de-identification**.
  Counsel should review whether that posture is acceptable or whether
  deletion must also cascade to history.
- Sessions expire on a rolling 90-day window from last activity.

**Policy target, NOT yet implemented:** automated deletion of inactive
device data after 90 days. No scheduled job currently deletes inactive
devices, attempts, scores, streaks, or outbox rows. A daily retention
sweep is planned before public launch; treat the 90-day window as a
design input for review, not an operational fact.

## Open questions for counsel

1. Audience classification: marketed to general K-pop fans; content is
   all-ages. Does the LatAm minor-audience mix trigger COPPA-analogue
   obligations (e.g., LFPDPPP minors provisions) given zero personal
   data collection?
2. Notice text: privacy notice copy + placement for a no-account,
   pseudonymous product.
3. Consent: is a consent banner needed with NO analytics and only
   strictly-necessary storage? (Current posture: no banner.)
4. Nominative artist references (see docs/CONTENT_REGISTER.md ⛔ rows):
   guidance for fan-culture references to real artists/groups.
5. Weekly cosmetic leaderboards with generated handles: any publicity
   concerns? (No real names exist in the system.)
