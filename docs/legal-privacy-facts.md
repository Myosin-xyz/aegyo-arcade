# Privacy Facts — EXT-LEGAL counsel briefing (Aegyo Arena)

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

| Data                                                                         | Where                                         | Purpose                                        | Notes                                                                                                           |
| ---------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Pseudonymous device ID (server-generated UUID)                               | Postgres `devices`                            | Ties runs/streaks/boards to a device           | No name, email, phone, or account anywhere                                                                      |
| Generated handle (e.g. "SunnyPhotocard97")                                   | `devices`                                     | Leaderboard display name                       | Server-curated wordlist; no free-text identity (META-3)                                                         |
| IANA timezone string                                                         | `devices`                                     | Player-local daily-run window (OD-1)           | Updated on change, timestamped                                                                                  |
| Locale ("en"/"es-419")                                                       | `devices`                                     | Language preference                            | Allowlisted values only                                                                                         |
| Session token (hashed at rest)                                               | `device_sessions` + HttpOnly host-only cookie | Session continuity                             | 90-day rolling expiry from last activity                                                                        |
| Daily play-slot bookkeeping (player-local day key, completion link)          | `daily_slots`                                 | One counted run per player-local day (OD-1)    | Day key derives from the stored timezone; no location                                                           |
| Run attempts (game id, server-issued seed, score, client-reported duration)  | `run_attempts`                                | Counted-run integrity + idempotent replays     | Result snapshot retained so replays return the original result                                                  |
| Board / streak rows (score, season key, streak counters)                     | `leaderboard_scores`, `streaks`               | Gameplay features                              | Weekly boards show handle + score                                                                               |
| Claw plays (client-generated idempotency key, server-drawn outcome, ordinal) | `claw_plays`                                  | Idempotent claw outcomes                       | Key is a random client UUID, not person-linked                                                                  |
| Prize claim rows (claim state per winning play)                              | `prize_claims`                                | Claw prize bookkeeping                         | No prizes at launch; empty in practice                                                                          |
| Analytics outbox (event name + coarse payload, e.g. score buckets)           | `analytics_outbox`                            | Written transactionally for a FUTURE publisher | No publisher drains these rows today                                                                            |
| Google Analytics 4 web measurement                                           | Google Analytics property `G-700MXJM1FW`      | Page views, sessions, aggregate site usage     | Production-only root-layout Google tag; no app device UUID, generated handle, score, run ID, or User-ID is sent |
| Ops audit rows (promotion activations, actor)                                | `ops_audit`                                   | Operator accountability                        | Internal only                                                                                                   |

Explicitly NOT collected by application forms or app tables: names,
emails, phone numbers, contacts, precise location (timezone only in the
app database), IP retention in app tables, photos, free-text input, or
third-party account identity. Google Analytics collection is described
separately above.

## Client-side storage

- HttpOnly session cookie (host-only)
- `localStorage`: mute flag, locale preference
- `sessionStorage`: campaign attribution (allowlisted utm_source /
  utm_medium / utm_campaign, 30-min inactivity window, first-touch;
  gclid/fbclid & co. are STRIPPED and never stored — OD-7 prohibits
  person-linked identifiers)
- Google Analytics first-party cookies (`_ga`, `_ga_<container-id>`) for
  distinguishing users and preserving session state. Google documents a
  default two-year expiry, subject to browser limits and property settings.

## Third parties

- Hosting: Vercel (app), Railway (Postgres). Their infrastructure
  logs (request logs, database logs) are retained per each provider's
  own policy and can transiently include IP addresses; no IPs are
  written to application tables.
- Google Analytics 4 is integrated through measurement ID
  `G-700MXJM1FW` on production deployments only (local development and
  Vercel Preview do not load it). Its default web collection includes
  page/session activity, approximate geolocation, browser/device
  information, page URL, and referrer. Known campaign/click identifiers
  are stripped before the production tag initializes. Google documents
  processing IP addresses at collection time for geolocation; the app
  does not persist them. The app does not set GA User-ID or send its
  device UUID, handle, gameplay IDs, or scores.
- GA property retention, data-sharing/Ads links, DPA, consent mode, and
  notice/banner posture remain EXT-LEGAL/operations decisions. No ad or
  social SDK is integrated; fonts remain self-hosted.

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
3. Consent: what notice/banner and Consent Mode posture is required for
   GA4 first-party analytics cookies for the actual audience/geographies?
   The Google tag is active today; no consent banner is implemented.
4. Nominative artist references (see docs/CONTENT_REGISTER.md ⛔ rows):
   guidance for fan-culture references to real artists/groups.
5. Weekly cosmetic leaderboards with generated handles: any publicity
   concerns? (No real names exist in the system.)
