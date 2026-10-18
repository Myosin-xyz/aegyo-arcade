# Mobile contract

The Aegyo mobile app (private repo `Myosin-xyz/aegyo-mobile`, Expo/React Native) embeds Arcade pages in a WebView and calls a few Arcade APIs natively. This file lists every Arcade surface that app depends on, as verified against this repo on 2026-10-18. Each item names the file that owns it.

Nothing on the web side notices when one of these changes, so `tests/unit/mobile-contract.test.ts` pins the catalog, the play-page hrefs, the locale key, the cookie names and the four API response shapes. The `mobile-parity` workflow labels any PR that touches the guarded paths and posts the checklist below.

## 1. Game catalog

The mobile catalog (`src/features/arcade/catalog.ts` in aegyo-mobile) is a static mirror. Adding, removing or renaming a game here needs a mobile release.

| Item                     | Owner                                                            | Contract                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Game ids and order       | `src/games/registry.ts` (`entries`)                              | 14 games, in this order: claw, snake, flappy, jumper, photocard-stack, perfect-toss, no-cap, fanchant-hero, bias-match, aegyo-pop, hangman, freebie, frogger, thisorthat |
| Title and tagline keys   | `src/games/<id>/meta.ts`                                         | `titleKey = game.<id>.title`, `taglineKey = game.<id>.tagline`                                                                                                           |
| Capabilities             | `src/games/<id>/meta.ts`                                         | `capabilities.counted` is true for all but thisorthat; `capabilities.prize` is true only for claw                                                                        |
| EN and es-419 copy       | `src/i18n/locales/en.json`, `src/i18n/locales/es-419.json`       | Both dictionaries carry every title and tagline                                                                                                                          |
| Posters                  | `public/games/<id>/preview-v1-en.webp`, `preview-v1-es-419.webp` | Path built by `landingPreview()` in `src/games/registry.ts`                                                                                                              |
| Which games have a board | `src/server/games-config.ts` (`COUNTED_GAMES`)                   | Every id except thisorthat. claw is listed with `scored: false`                                                                                                          |

The web home page shuffles the registry per request (`src/app/game-order.ts`), so registry order is the canonical order only for the mirror and the contract test.

## 2. Play page in the WebView

`/play/[gameId]` is rendered by `src/app/play/[gameId]/page.tsx` and `src/shell/host.tsx`.

Before load, the app writes `localStorage["aa-locale"]` as `en` or `es-419`. The key is `LOCALE_STORAGE_KEY` in `src/i18n/t.ts`, read by `resolveClientLocale()` and written by `src/app/locale-toggle.tsx`. The locale codes are `LOCALES` in the same file.

The app injects a document-start click-capture script that turns these anchors into native navigation:

| href                        | Where in `src/shell/host.tsx`                                                                     | Native destination |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ------------------ |
| exactly `/`                 | Header back link (`data-testid="host-back"`) and the unknown-game fallback                        | Games list         |
| starts with `/championship` | `/championship?game=<id>` "join monthly leaderboard" link, shown only when `monthlyJoinAvailable` | Championship       |
| starts with `/leaderboard/` | `/leaderboard/<gameId>` "view board" link on the counted-run receipt                              | Game leaderboard   |

The script also accepts `/championship?round=<slug>`; that form comes from `src/app/championship/championship-panel.tsx`, not from the host.

Turning any of these into a button, changing the href, or adding a new `href` to the host breaks the mobile experience without any error. The contract test fails on all three, including any new host href outside the intercepted set.

Official attempts are started by the web runtime, never natively. Two entry points exist (`src/app/play/[gameId]/page.tsx`):

- `/play/<id>?championship=<roundId>` with a UUID round id.
- Plain `/play/<id>` for a signed-in, email-verified member already enrolled in the active round for that game. The page discovers the round itself (`activeRoundForGame`) and the host offers the official run.

## 3. Sign-in and enrollment pages in the WebView

| Surface                      | Owner                                           | Contract                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/account`                   | `src/app/account/page.tsx`, `account-panel.tsx` | Sign-in buttons link to `/api/accounts/login?returnTo=%2Faccount`                                                                                                                                                                                                                             |
| `/championship`              | `src/app/championship/page.tsx`                 | 404 unless `ARCADE_COMPETITION_ENABLED=true`. `?round=<slug>` and `?game=<id>` are accepted; `game` only for snake, flappy, perfect-toss, hangman, no-cap                                                                                                                                     |
| `GET /api/accounts/login`    | `src/app/api/accounts/login/route.ts`           | Redirects to account.aegyoarena.com. `returnTo` is filtered by `safeAccountReturnTo()` in `src/accounts/transaction.ts`                                                                                                                                                                       |
| `GET /api/accounts/callback` | `src/app/api/accounts/callback/route.ts`        | Sets the member cookie and redirects to the filtered `returnTo`: `/account`, `/championship`, or `/play/(snake\|flappy)?championship=<uuid>`. Anything else lands on `/`                                                                                                                      |
| `POST /api/accounts/logout`  | `src/app/api/accounts/logout/route.ts`          | `{ok: true, next: "https://account.aegyoarena.com/sign-out?return=arcade"}` only when the configured app origin is exactly `https://arcade.aegyoarena.com` and the request is on it; otherwise `{ok: true}`. 403 `bad_origin` on a mismatched Origin, 404 `not_found` without accounts config |
| `/browser-sign-out`          | `src/app/browser-sign-out/page.tsx`             | A hop in the provider's sign-out chain; `?return=` accepts aegyo, arcade, daebak                                                                                                                                                                                                              |
| Member cookie                | `src/accounts/cookies.ts` (`MEMBER_COOKIE`)     | `__Host-aegyo_member`                                                                                                                                                                                                                                                                         |

## 4. Native API calls

### `POST /api/session`

Owner: `src/app/api/session/route.ts`, origin check `sameOriginOk()` in `src/app/api/_shared/http.ts`, cookie `SESSION_COOKIE` in `src/server/identity.ts`.

- Body `{timeZone, locale}` as JSON. `locale` is kept only if it is `en` or `es-419`.
- `Origin` must equal the Arcade origin. A missing Origin is allowed; a mismatched one gets 403 `{code: "bad_origin"}`.
- 200 `{ok: true, locale, handle}`. `handle` can be null. Sets `__Host-aegyo_device` (httpOnly, 90-day rolling).
- 503 `{code: "service_unavailable"}` without a database.

### `GET /api/leaderboards/[gameId]`

Owner: `src/app/api/leaderboards/[gameId]/route.ts`, shape from `getSeasonBoard()` in `src/server/leaderboard.ts`.

- Device cookie required. The session check runs before the game check, so an unknown game without a cookie still answers 401.
- 401 `{code: "no_session"}` or `{code: "invalid_session"}`; 503 `service_unavailable` without a database.
- 404 `{code: "unknown_game"}` for ids outside `COUNTED_GAMES` (thisorthat).
- 200 `{seasonKey, top: [{rank, handle, score, you}], me: {rank, score} | null}`. `top` holds at most 50 rows with competition ranking (ties share a rank).
- claw answers 200 with `top: []` and `me: null`. Its outcomes carry score 0 and `MIN_PLACING_SCORE` is 1, so nothing places.

### `GET /api/competition[?round=<slug>]`

Owner: `src/app/api/competition/route.ts`, shape from `publicRound()` in `src/competition/read.ts` and `publicRules()` in `src/competition/rules.ts`. Mobile derives all rules copy from this payload.

- Public, no cookie. 404 `{code: "not_found"}` unless `ARCADE_COMPETITION_ENABLED=true`.
- With a visible round: `{serverNow, rounds: [{slug, status, opensAt, closesAt}], round: {id, slug, status, opensAt, closesAt, mode, rules, rulesDigest}, standings: [{username, rank, totalPoints, topTierResults, maxDailyPoints, maxPeriodPoints}], gameHighScores: [{gameId, username, score}], provisional}`.
- Without a visible round: `{round: null, rounds, standings: [], provisional: true}`. `serverNow` and `gameHighScores` are absent in this case.
- `rules` (v2): `{version, mode, dailyAttempts, attemptTtlSeconds, games: [{gameId, calibration: [{score, points}]}], cadence, winnerCount, scoring: {timeZone, bestPerGame, fullArenaBonusPoints}}`. v1 rounds omit `cadence`, `winnerCount` and `scoring`. `rulesUrl` and `approval` appear only when configured (material-prize rounds).
- Competition game ids are limited to snake, flappy, perfect-toss, hangman, no-cap (`CompetitionGame` in `src/competition/rules.ts`).

### `GET /api/competition/me?roundId=<uuid>`

Owner: `src/app/api/competition/me/route.ts`, member check `memberContext()` in `src/competition/http.ts`, shape from `memberRound()` in `src/competition/read.ts`.

- Member cookie required. The cookie check runs before the round id check.
- 401 `{code: "sign_in_required"}`; 400 `{code: "invalid_round"}`; 503 `accounts_unavailable` or `identity_provider_unavailable`; 404 `not_found` when the competition is disabled.
- 200 `{enrolled, username, emailVerified, attempts, remaining, totalPoints, rank, currentPeriod, awards}`.
- `attempts[]`: `{id, gameId, dayKey, scorePeriodKey, status, score, points}`, straight from the SQL column aliases.
- `remaining`: `{[gameId]: n}` for each game in the round's rules.
- `currentPeriod`: `{periodKey, completedGames, eligibleGames, games: [{gameId, points, completed}], fullArena: {configuredPoints, earned, earnedPoints}}`, or null unless the round is v2 and open right now.
- `awards[]`: `{id, awardKey, status, rank}`.

The native layer never submits scores. Attempts start in the WebView runtime (section 2).

## 5. Copy mirrored natively

| Copy                       | Owner                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Championship panel wording | Inline `translations` object (en and es-419) in `src/app/championship/championship-panel.tsx`, not the i18n dictionaries. Mirrored lines: `communityNoPrizes` (community round, no prizes), `signedOut` (sign-in line)                                             |
| Monthly points semantics   | `src/i18n/locales/*.json` keys `host.joinMonthlyLeaderboard`, `host.leaderboardRun`, `host.leaderboardRunNote`, `host.dailyRunNote`, `host.monthlyAttemptsSpent`, rendered in `src/shell/host.tsx`. Which games earn monthly points comes from `round.rules.games` |

There is no literal "Monthly points" badge on the web. The native badge mirrors the meaning of the keys above: a counted run inside an enrolled monthly round earns points, a daily run does not.

## How to change something here

1. Keep the change backward compatible (add fields, never rename or remove), or version it so the shipped app keeps working until a mobile release catches up.
2. Update this doc in the same PR, and the expectations in `tests/unit/mobile-contract.test.ts`.
3. Open an issue in aegyo-mobile titled `web-parity: <change>` and link it from the PR:

   ```sh
   gh issue create --repo Myosin-xyz/aegyo-mobile --label web-parity \
     --title "web-parity: <change>" --body "<what changed, link to the arcade PR>"
   ```

   If the label does not exist yet, create it once with `gh label create web-parity --repo Myosin-xyz/aegyo-mobile`.

4. For a new game, the checklist also needs: the mobile catalog entry in `src/features/arcade/catalog.ts` and both posters (`preview-v1-en.webp`, `preview-v1-es-419.webp`) shipped under `public/games/<id>/`.
5. For a new user-facing feature, state in the PR whether mobile will ship it, skip it, or take it as a follow-up.
