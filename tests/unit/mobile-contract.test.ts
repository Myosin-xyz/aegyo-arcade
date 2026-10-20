// @vitest-environment node
/**
 * Mobile parity contract (docs/MOBILE_CONTRACT.md). The Aegyo mobile app
 * (Myosin-xyz/aegyo-mobile) mirrors the game catalog statically, loads
 * /play/[gameId] in a WebView with an injected click-capture script, and
 * calls the session, leaderboard and competition APIs natively. Nothing
 * on the web side would otherwise notice when one of those surfaces
 * changes, so these assertions fail loudly instead.
 *
 * If one of these fails because you changed a surface on purpose: keep it
 * backward compatible or version it, update docs/MOBILE_CONTRACT.md in the
 * same PR, and open a "web-parity: <change>" issue in aegyo-mobile.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  db: { execute: vi.fn(), select: vi.fn() },
  resolveSession: vi.fn(),
  createDeviceSession: vi.fn(),
  touchSession: vi.fn(),
  authorizeMemberSession: vi.fn(),
}));

vi.mock("@/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/server/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/identity")>()),
  resolveSession: mocks.resolveSession,
  createDeviceSession: mocks.createDeviceSession,
  touchSession: mocks.touchSession,
}));
vi.mock("@/accounts/config", () => ({
  getAccountsConfig: () => ({ appOrigin: "https://arcade.example.test" }),
}));
vi.mock("@/accounts/authorization", () => ({
  authorizeMemberSession: mocks.authorizeMemberSession,
}));

import { listGames } from "@/games/registry";
import { LOCALE_STORAGE_KEY, LOCALES } from "@/i18n/t";
import en from "@/i18n/locales/en.json";
import es419 from "@/i18n/locales/es-419.json";
import { MEMBER_COOKIE } from "@/accounts/cookies";
import { SESSION_COOKIE } from "@/server/identity";
import { POST as postSession } from "@/app/api/session/route";
import { GET as getLeaderboard } from "@/app/api/leaderboards/[gameId]/route";
import { GET as getCompetition } from "@/app/api/competition/route";
import { GET as getCompetitionMe } from "@/app/api/competition/me/route";

import {
  GET as getDeletionReadiness,
  POST as postDeletion,
} from "@/app/api/internal/account-deletion/route";

const ARCADE = "https://arcade.example.test";
const CONTRACT =
  "the Aegyo mobile app (Myosin-xyz/aegyo-mobile) depends on this; see docs/MOBILE_CONTRACT.md";

/** The catalog the mobile app mirrors, in registry order. */
const MOBILE_GAME_IDS = [
  "claw",
  "snake",
  "flappy",
  "jumper",
  "photocard-stack",
  "perfect-toss",
  "no-cap",
  "fanchant-hero",
  "bias-match",
  "aegyo-pop",
  "hangman",
  "freebie",
  "frogger",
  "thisorthat",
];

/** What the mobile app writes to localStorage before loading a page. */
const MOBILE_LOCALE_KEY = "aa-locale";
const MOBILE_LOCALES = ["en", "es-419"];

const keys = (value: unknown) =>
  Object.keys(value as Record<string, unknown>).sort();

const sorted = (list: string[]) => [...list].sort();

/** Raw SQL text of a drizzle `sql` template, params replaced by `?`. */
function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((chunk) =>
      chunk &&
      typeof chunk === "object" &&
      Array.isArray((chunk as { value?: unknown }).value)
        ? (chunk as { value: string[] }).value.join("")
        : "?",
    )
    .join("")
    .replace(/\s+/g, " ");
}

/**
 * db.execute stub that answers by SQL shape rather than call order, so
 * reordering queries inside the read model does not break this test.
 */
function routeExecute(routes: [RegExp, Record<string, unknown>[]][]) {
  const seen: string[] = [];
  mocks.db.execute.mockImplementation(async (query: unknown) => {
    const text = sqlText(query);
    seen.push(text);
    const match = routes.find(([pattern]) => pattern.test(text));
    return { rows: match ? match[1] : [] };
  });
  return seen;
}

/**
 * Minimal drizzle query-builder stub: every builder method chains and the
 * awaited chain yields the next queued result set.
 */
function queueSelects(results: unknown[][]) {
  mocks.db.select.mockImplementation(() => {
    const result = results.shift() ?? [];
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "innerJoin", "where", "orderBy", "limit"])
      chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => resolve(result);
    return chain;
  });
}

const device = {
  deviceId: "device-1",
  locale: "es-419",
  handle: "BiasStan42",
  timeZone: "America/Bogota",
};

const ROUND_ID = "6f9b4a52-1d1c-4c6b-9a3e-0f6f0d2b7c11";
const rules = {
  version: 2,
  mode: "community",
  dailyAttempts: 2,
  attemptTtlSeconds: 900,
  games: ["snake", "flappy", "perfect-toss"].map((gameId) => ({
    gameId,
    calibration: [
      { score: 0, points: 0 },
      { score: 1, points: 10 },
    ],
  })),
  cadence: "monthly",
  winnerCount: 3,
  scoring: {
    bestPerGame: "week",
    timeZone: "America/New_York",
    fullArenaBonusPoints: 20,
  },
};
const roundRow = {
  id: ROUND_ID,
  slug: "october-2026",
  status: "open",
  opens_at: new Date("2026-10-01T04:00:00Z"),
  closes_at: new Date("2099-11-01T04:00:00Z"),
  rules,
  server_now: new Date("2026-10-18T15:00:00Z"),
};

beforeEach(() => {
  vi.stubEnv("ARCADE_COMPETITION_ENABLED", "true");
  vi.stubEnv("ARCADE_APP_ORIGIN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("mobile contract: game catalog", () => {
  it("registry holds exactly the 14 games the mobile catalog mirrors, in order", () => {
    expect(
      listGames().map((entry) => entry.meta.id),
      `Game added, removed, renamed or reordered: ${CONTRACT} (mobile catalog is a static mirror)`,
    ).toEqual(MOBILE_GAME_IDS);
  });

  it("every game keeps its title/tagline keys, both translations, capabilities and posters", () => {
    for (const { meta } of listGames()) {
      expect(meta.titleKey, `${meta.id} titleKey: ${CONTRACT}`).toBe(
        `game.${meta.id}.title`,
      );
      expect(meta.taglineKey, `${meta.id} taglineKey: ${CONTRACT}`).toBe(
        `game.${meta.id}.tagline`,
      );
      for (const dict of [en, es419] as Record<string, string>[]) {
        expect(dict[meta.titleKey], `${meta.titleKey}: ${CONTRACT}`).toEqual(
          expect.any(String),
        );
        expect(
          dict[meta.taglineKey],
          `${meta.taglineKey}: ${CONTRACT}`,
        ).toEqual(expect.any(String));
      }
      expect(typeof meta.capabilities.counted).toBe("boolean");
      expect(typeof meta.capabilities.prize).toBe("boolean");
      for (const locale of MOBILE_LOCALES) {
        const poster = fileURLToPath(
          new URL(
            `../../public/games/${meta.id}/preview-v1-${locale}.webp`,
            import.meta.url,
          ),
        );
        expect(
          () => readFileSync(poster),
          `Missing poster ${poster}: ${CONTRACT}`,
        ).not.toThrow();
      }
    }
  });
});

describe("mobile contract: play page WebView navigation", () => {
  const host = readFileSync(
    fileURLToPath(new URL("../../src/shell/host.tsx", import.meta.url)),
    "utf8",
  );
  const message = (what: string) =>
    `src/shell/host.tsx must keep ${what}. The mobile WebView intercepts anchors with href "/", "/championship…" and "/leaderboard/…" and routes them to native screens; ${CONTRACT}`;

  it('keeps the back-to-games anchor with href="/"', () => {
    expect(host, message('a <Link href="/"> back link')).toMatch(
      /<Link[^>]*\bhref="\/"/,
    );
  });

  it("keeps a /championship anchor", () => {
    expect(host, message("a /championship <Link> href")).toMatch(
      /href=\{`\/championship(\?[^`]*)?`\}/,
    );
  });

  it("keeps a /leaderboard/ anchor", () => {
    expect(host, message("a /leaderboard/<gameId> <Link> href")).toMatch(
      /href=\{`\/leaderboard\/\$\{gameId\}`\}/,
    );
  });

  it("adds no navigation the WebView would not intercept", () => {
    const hrefs = [...host.matchAll(/href=(\{`[^`]*`\}|"[^"]*")/g)].map(
      (match) => match[1],
    );
    const intercepted = (href: string) =>
      href === '"/"' ||
      href.startsWith("{`/championship") ||
      href.startsWith("{`/leaderboard/");
    expect(
      hrefs.filter((href) => !intercepted(href)),
      message("only intercepted hrefs (a new link opens inside the WebView)"),
    ).toEqual([]);
  });
});

describe("mobile contract: locale handoff", () => {
  it("reads the localStorage key and locale codes the app writes", () => {
    expect(LOCALE_STORAGE_KEY, `Locale storage key: ${CONTRACT}`).toBe(
      MOBILE_LOCALE_KEY,
    );
    expect([...LOCALES], `Locale codes: ${CONTRACT}`).toEqual(MOBILE_LOCALES);
  });

  it("keeps the cookie names the app's WebView and native calls share", () => {
    expect(SESSION_COOKIE).toBe("__Host-aegyo_device");
    expect(MEMBER_COOKIE).toBe("__Host-aegyo_member");
  });
});

describe("mobile contract: member session lifetime", () => {
  it("client=mobile selects the 90-day member session; anything else is the 1-day web session", async () => {
    const accounts =
      await vi.importActual<typeof import("@/accounts/config")>(
        "@/accounts/config",
      );
    expect(accounts.parseAccountClient("mobile"), CONTRACT).toBe("mobile");
    expect(accounts.parseAccountClient(null), CONTRACT).toBe("web");
    expect(accounts.parseAccountClient("Mobile"), CONTRACT).toBe("web");
    expect(accounts.memberSessionTtlSeconds("mobile"), CONTRACT).toBe(
      90 * 24 * 60 * 60,
    );
    expect(accounts.memberSessionTtlSeconds("web"), CONTRACT).toBe(
      24 * 60 * 60,
    );
  });
});

describe("mobile contract: POST /api/session", () => {
  const request = (origin?: string) =>
    new NextRequest(`${ARCADE}/api/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify({ timeZone: "America/Bogota", locale: "es-419" }),
    });

  it("returns {ok, locale, handle} and sets the device cookie", async () => {
    mocks.createDeviceSession.mockResolvedValue({ token: "raw-token", device });
    for (const origin of [ARCADE, undefined]) {
      const response = await postSession(request(origin));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(keys(body), `/api/session body: ${CONTRACT}`).toEqual([
        "handle",
        "locale",
        "ok",
      ]);
      expect(body).toEqual({
        ok: true,
        locale: "es-419",
        handle: "BiasStan42",
      });
      expect(response.headers.get("set-cookie")).toContain(
        `${SESSION_COOKIE}=raw-token`,
      );
    }
    expect(mocks.createDeviceSession).toHaveBeenCalledWith(mocks.db, {
      timeZone: "America/Bogota",
      locale: "es-419",
    });
  });

  it("rejects a mismatched Origin with 403 bad_origin", async () => {
    const response = await postSession(request("https://evil.example.test"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "bad_origin" });
  });
});

describe("mobile contract: GET /api/leaderboards/[gameId]", () => {
  const call = (gameId: string, cookie = true) =>
    getLeaderboard(
      new NextRequest(`${ARCADE}/api/leaderboards/${gameId}`, {
        headers: cookie ? { cookie: `${SESSION_COOKIE}=raw-token` } : {},
      }),
      { params: Promise.resolve({ gameId }) },
    );

  it("401s with no_session / invalid_session", async () => {
    let response = await call("snake", false);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "no_session" });
    mocks.resolveSession.mockResolvedValue(null);
    response = await call("snake");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "invalid_session" });
  });

  it("returns {seasonKey, top[{rank, handle, score, you}], me}", async () => {
    mocks.resolveSession.mockResolvedValue(device);
    queueSelects([
      [
        { score: 900, handle: "Other", deviceId: "device-2" },
        { score: 500, handle: "BiasStan42", deviceId: "device-1" },
      ],
      [{ score: 500 }],
      [{ count: 1 }],
    ]);
    const response = await call("snake");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(keys(body), `leaderboard body: ${CONTRACT}`).toEqual([
      "me",
      "seasonKey",
      "top",
    ]);
    expect(typeof body.seasonKey).toBe("string");
    expect(keys(body.top[0]), `leaderboard row: ${CONTRACT}`).toEqual([
      "handle",
      "rank",
      "score",
      "you",
    ]);
    expect(body.top[1]).toEqual({
      rank: 2,
      handle: "BiasStan42",
      score: 500,
      you: true,
    });
    expect(body.me).toEqual({ rank: 2, score: 500 });
  });

  it("claw answers 200 with an empty board; thisorthat has no board (404 unknown_game)", async () => {
    mocks.resolveSession.mockResolvedValue(device);
    queueSelects([[], []]);
    const claw = await call("claw");
    expect(claw.status).toBe(200);
    expect(await claw.json()).toMatchObject({ top: [], me: null });
    const thisorthat = await call("thisorthat");
    expect(thisorthat.status).toBe(404);
    expect(await thisorthat.json()).toEqual({ code: "unknown_game" });
  });
});

describe("mobile contract: GET /api/competition", () => {
  const call = (query = "") =>
    getCompetition(new NextRequest(`${ARCADE}/api/competition${query}`));

  it("returns the public round payload mobile derives all rules copy from", async () => {
    routeExecute([
      [/SELECT \*,statement_timestamp\(\)/, [roundRow]],
      [
        /SELECT slug,status,opens_at,closes_at/,
        [
          {
            slug: "october-2026",
            status: "open",
            opens_at: roundRow.opens_at,
            closes_at: roundRow.closes_at,
          },
        ],
      ],
      [
        /FROM competition_period_best/,
        [
          {
            memberId: "m1",
            gameId: "snake",
            points: 10,
            dayKey: "2026-10-12",
            receivedAt: new Date("2026-10-12T12:00:00Z"),
          },
        ],
      ],
      [
        /SELECT member_id,username FROM competition_profiles/,
        [{ member_id: "m1", username: "stan" }],
      ],
      [
        /FROM competition_attempts a/,
        [{ gameId: "snake", username: "stan", score: 42 }],
      ],
    ]);
    const response = await call("?round=october-2026");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(keys(body), `competition body: ${CONTRACT}`).toEqual([
      "gameHighScores",
      "provisional",
      "round",
      "rounds",
      "serverNow",
      "standings",
    ]);
    expect(keys(body.rounds[0])).toEqual([
      "closesAt",
      "opensAt",
      "slug",
      "status",
    ]);
    expect(keys(body.round), `competition round: ${CONTRACT}`).toEqual([
      "closesAt",
      "id",
      "mode",
      "opensAt",
      "rules",
      "rulesDigest",
      "slug",
      "status",
    ]);
    expect(keys(body.round.rules), `competition rules: ${CONTRACT}`).toEqual(
      sorted([
        "version",
        "mode",
        "dailyAttempts",
        "attemptTtlSeconds",
        "games",
        "cadence",
        "winnerCount",
        "scoring",
      ]),
    );
    expect(keys(body.round.rules.games[0])).toEqual(["calibration", "gameId"]);
    expect(keys(body.round.rules.games[0].calibration[0])).toEqual([
      "points",
      "score",
    ]);
    expect(keys(body.round.rules.scoring)).toEqual([
      "bestPerGame",
      "fullArenaBonusPoints",
      "timeZone",
    ]);
    expect(keys(body.standings[0]), `standing row: ${CONTRACT}`).toEqual(
      sorted([
        "username",
        "rank",
        "totalPoints",
        "topTierResults",
        "maxDailyPoints",
        "maxPeriodPoints",
      ]),
    );
    expect(keys(body.gameHighScores[0])).toEqual([
      "gameId",
      "score",
      "username",
    ]);
  });

  it("with no visible round returns {round: null, rounds, standings: [], provisional}", async () => {
    routeExecute([]);
    const response = await call();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(keys(body), `empty competition body: ${CONTRACT}`).toEqual([
      "provisional",
      "round",
      "rounds",
      "standings",
    ]);
    expect(body.round).toBeNull();
  });
});

describe("mobile contract: GET /api/competition/me", () => {
  const call = (roundId: string | null, cookie = true) =>
    getCompetitionMe(
      new NextRequest(
        `${ARCADE}/api/competition/me${roundId === null ? "" : `?roundId=${roundId}`}`,
        { headers: cookie ? { cookie: `${MEMBER_COOKIE}=member-token` } : {} },
      ),
    );

  beforeEach(() => {
    mocks.authorizeMemberSession.mockResolvedValue({
      kind: "allowed",
      session: { memberId: "m1", emailVerified: true },
    });
  });

  it("401 sign_in_required without the member cookie; 400 invalid_round", async () => {
    let response = await call(ROUND_ID, false);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "sign_in_required" });
    response = await call("not-a-uuid");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "invalid_round" });
  });

  it("returns the member round payload", async () => {
    const seen = routeExecute([
      [/SELECT rules,status,opens_at,closes_at/, [roundRow]],
      [/SELECT 1 FROM competition_enrollments/, [{ "?column?": 1 }]],
      [/SELECT username FROM competition_profiles/, [{ username: "stan" }]],
      [
        /FROM competition_attempts WHERE/,
        [
          {
            id: "a1",
            gameId: "snake",
            dayKey: "2026-10-18",
            scorePeriodKey: "2026-10-12",
            status: "verified",
            score: 42,
            points: 10,
          },
        ],
      ],
      [/FROM competition_award_claims c/, []],
      [
        /SELECT game_id AS "gameId",points FROM competition_period_best/,
        [{ gameId: "snake", points: 10 }],
      ],
    ]);
    const response = await call(ROUND_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(keys(body), `competition/me body: ${CONTRACT}`).toEqual(
      sorted([
        "enrolled",
        "username",
        "emailVerified",
        "attempts",
        "remaining",
        "totalPoints",
        "rank",
        "currentPeriod",
        "awards",
      ]),
    );
    expect(body.enrolled).toBe(true);
    expect(keys(body.remaining)).toEqual(["flappy", "perfect-toss", "snake"]);
    expect(keys(body.currentPeriod), `currentPeriod: ${CONTRACT}`).toEqual(
      sorted([
        "periodKey",
        "completedGames",
        "eligibleGames",
        "games",
        "fullArena",
      ]),
    );
    // Attempt rows pass through from SQL: the column aliases ARE the contract.
    const attemptsSql = seen.find((text) =>
      text.includes("FROM competition_attempts WHERE"),
    );
    for (const alias of [
      "id",
      'game_id AS "gameId"',
      'day_key AS "dayKey"',
      'score_period_key AS "scorePeriodKey"',
      "status",
      "score",
      "points",
    ])
      expect(attemptsSql, `attempt column ${alias}: ${CONTRACT}`).toContain(
        alias,
      );
  });
});

describe("shared deletion transport", () => {
  it("does not accept mobile session cookies as deletion authority", async () => {
    vi.stubEnv("AEGYO_ACCOUNT_DELETION_KEY", "s".repeat(40));
    const headers = { cookie: `${MEMBER_COOKIE}=mobile-session` };
    for (const [method, handler] of [
      ["GET", getDeletionReadiness],
      ["POST", postDeletion],
    ] as const) {
      const response = await handler(
        new NextRequest(`${ARCADE}/api/internal/account-deletion`, {
          method,
          headers,
        }),
      );
      expect(response.status, CONTRACT).toBe(401);
      expect(await response.json(), CONTRACT).toEqual({
        error: "unauthorized",
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});

describe("October starter standings shared by web and mobile", () => {
  it("keeps the public and signed-in rank consistent without inventing attempts or score writes", async () => {
    const october = {
      ...roundRow,
      slug: "october-2026-community-leaderboard",
      closes_at: new Date("2026-11-01T04:00:00Z"),
      server_now: new Date("2026-10-20T21:30:00Z"),
    };
    mocks.authorizeMemberSession.mockResolvedValue({
      kind: "allowed",
      session: { memberId: "m1", emailVerified: true },
    });
    const seen = routeExecute([
      [/SELECT \*,statement_timestamp/, [october]],
      [/SELECT rules,status,opens_at,closes_at/, [october]],
      [/SELECT slug,status,opens_at,closes_at/, []],
      [/SELECT 1 FROM competition_enrollments/, [{ exists: 1 }]],
      [
        /SELECT username FROM competition_profiles/,
        [{ username: "real_player" }],
      ],
      [
        /SELECT member_id,username FROM competition_profiles/,
        [{ member_id: "m1", username: "real_player" }],
      ],
      [
        /FROM competition_period_best/,
        [
          {
            memberId: "m1",
            gameId: "snake",
            points: 5,
            dayKey: "2026-10-19",
            receivedAt: new Date("2026-10-20T12:00:00Z"),
          },
        ],
      ],
    ]);
    const response = await getCompetition(
      new NextRequest(`${ARCADE}/api/competition`),
    );
    expect(response.status).toBe(200);
    const publicBoard = await response.json();
    expect(publicBoard.standings).toHaveLength(20);
    expect(publicBoard.gameHighScores).toEqual([]);
    const memberResponse = await getCompetitionMe(
      new NextRequest(`${ARCADE}/api/competition/me?roundId=${ROUND_ID}`, {
        headers: { cookie: `${MEMBER_COOKIE}=member-token` },
      }),
    );
    expect(memberResponse.status).toBe(200);
    const member = await memberResponse.json();
    expect(member.totalPoints).toBe(5);
    expect(member.attempts).toEqual([]);
    expect(member.rank).toBe(16);
    expect(
      publicBoard.standings.find(
        (row: { username: string }) => row.username === "real_player",
      ).rank,
    ).toBe(member.rank);
    expect(seen.every((statement) => /^SELECT/.test(statement.trim()))).toBe(
      true,
    );
    expect(JSON.stringify(publicBoard)).not.toMatch(
      /starter_profiles|asOfDate|"starter"/,
    );
  });
});
