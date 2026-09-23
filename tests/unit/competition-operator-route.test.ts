// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  body: {} as Record<string, unknown>,
  context: {
    db: { execute: vi.fn() },
    actor: "accounts:user_1",
  },
  openRound: vi.fn(),
  closeRound: vi.fn(),
  disqualifyAttempt: vi.fn(),
  finalizeRound: vi.fn(),
  fulfillAward: vi.fn(),
  rejectPendingAttempt: vi.fn(),
  settleAttempt: vi.fn(),
  dashboard: vi.fn(),
}));

vi.mock("@/competition/http", () => ({
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  boundedBody: vi.fn(async () => mocks.body),
  handle: async (action: () => Promise<NextResponse>) => action(),
  response: (body: unknown, status = 200) =>
    NextResponse.json(body, { status }),
}));
vi.mock("@/competition/operator-auth", () => ({
  competitionOperatorContext: vi.fn(async () => mocks.context),
}));
vi.mock("@/competition/operations-store", () => ({
  openRound: mocks.openRound,
  closeRound: mocks.closeRound,
  disqualifyAttempt: mocks.disqualifyAttempt,
  finalizeRound: mocks.finalizeRound,
  fulfillAward: mocks.fulfillAward,
  rejectPendingAttempt: mocks.rejectPendingAttempt,
  settleAttempt: mocks.settleAttempt,
}));
vi.mock("@/competition/operator-dashboard", () => ({
  competitionOperatorDashboard: mocks.dashboard,
}));

import { competitionOperatorContext } from "@/competition/operator-auth";
import { POST } from "@/app/api/competition/operator/actions/route";
import { GET } from "@/app/api/competition/operator/route";

const roundId = "10000000-0000-4000-8000-000000000001";
const memberId = "20000000-0000-4000-8000-000000000001";

function request() {
  return new NextRequest(
    "https://arcade.example.test/api/competition/operator/actions",
    { method: "POST", body: "{}" },
  );
}

describe("competition operator actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.body = {};
    mocks.openRound.mockResolvedValue({
      roundId,
      status: "open",
      repeated: false,
    });
    mocks.finalizeRound.mockResolvedValue({
      finalResultId: "30000000-0000-4000-8000-000000000001",
      standings: [{ memberId }],
      repeated: false,
    });
    mocks.settleAttempt.mockResolvedValue({
      attemptId: memberId,
      status: "verified",
      repeated: false,
    });
    mocks.disqualifyAttempt.mockResolvedValue({ repeated: false });
    mocks.dashboard.mockResolvedValue({ selected: null, rounds: [] });
  });

  it("rejects partial or malformed pending pagination cursors", async () => {
    await expect(
      GET(
        new NextRequest(
          "https://arcade.example.test/api/competition/operator?pendingAfterAt=2026-09-17T00%3A00%3A00.000001Z",
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid_pending_cursor", status: 400 });
    await expect(
      GET(
        new NextRequest(
          "https://arcade.example.test/api/competition/operator?pendingAfterAt=not-a-date&pendingAfterId=10000000-0000-4000-8000-000000000001",
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid_pending_cursor", status: 400 });
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });

  it("passes a complete pending cursor to the operator dashboard", async () => {
    const receivedAt = "2026-09-17T00:00:00.000001Z";
    const response = await GET(
      new NextRequest(
        `https://arcade.example.test/api/competition/operator?roundId=${roundId}&pendingAfterAt=${encodeURIComponent(receivedAt)}&pendingAfterId=${memberId}`,
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.dashboard).toHaveBeenCalledWith(mocks.context.db, roundId, {
      receivedAt,
      id: memberId,
    });
  });

  it("opens a round only through the sensitive operator context", async () => {
    mocks.body = {
      action: "open",
      roundId,
      confirmation: `open:${roundId}`,
      idempotencyKey: "operator-request-0001",
    };
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(competitionOperatorContext).toHaveBeenCalledWith(expect.anything(), {
      mutation: true,
    });
    expect(mocks.openRound).toHaveBeenCalledWith(mocks.context.db, {
      roundId,
      actor: "accounts:user_1",
      idempotencyKey: "operator-request-0001",
    });
  });

  it("requires action-bound confirmation", async () => {
    mocks.body = {
      action: "open",
      roundId,
      confirmation: `close:${roundId}`,
      idempotencyKey: "operator-request-0001",
    };
    await expect(POST(request())).rejects.toMatchObject({
      code: "operator_confirmation_required",
      status: 409,
    });
    expect(mocks.openRound).not.toHaveBeenCalled();
  });

  it("settles through the audited operator operation", async () => {
    mocks.body = {
      action: "settle",
      roundId,
      attemptId: memberId,
      confirmation: `settle:${memberId}`,
      idempotencyKey: "operator-settle-0001",
    };
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.settleAttempt).toHaveBeenCalledWith(mocks.context.db, {
      roundId,
      attemptId: memberId,
      actor: "accounts:user_1",
      idempotencyKey: "operator-settle-0001",
    });
  });

  it("passes a reviewed disqualification to the guarded operation", async () => {
    mocks.body = {
      action: "disqualify",
      roundId,
      attemptId: memberId,
      reason: "published-automation-rule",
      confirmation: `disqualify:${memberId}`,
      idempotencyKey: "operator-disqualify-0001",
    };
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.disqualifyAttempt).toHaveBeenCalledWith(mocks.context.db, {
      roundId,
      attemptId: memberId,
      actor: "accounts:user_1",
      reason: "published-automation-rule",
      idempotencyKey: "operator-disqualify-0001",
    });
  });

  it("passes reviewed shared ties and explicit awards to finalization", async () => {
    mocks.body = {
      action: "finalize",
      roundId,
      confirmation: `finalize:${roundId}`,
      idempotencyKey: "operator-request-0002",
      tieDecisions: [
        {
          exactTieKey: "20:20:2026-09-21T00:00:00.000Z",
          resolution: "shared_rank",
          memberIds: [memberId, "40000000-0000-4000-8000-000000000001"],
          rationale: "The published rules retain the shared rank.",
        },
      ],
      awards: [
        {
          memberId,
          awardKey: "weekly-winner",
          allocationRationale: "Published first place allocation.",
        },
      ],
    };
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.finalizeRound).toHaveBeenCalledWith(
      mocks.context.db,
      expect.objectContaining({
        roundId,
        approvedBy: "accounts:user_1",
        awards: [
          {
            memberId,
            awardKey: "weekly-winner",
            allocationRationale: "Published first place allocation.",
          },
        ],
      }),
    );
  });

  it("rejects an unreviewed tie before finalization", async () => {
    mocks.body = {
      action: "finalize",
      roundId,
      confirmation: `finalize:${roundId}`,
      idempotencyKey: "operator-request-0003",
      tieDecisions: [
        {
          exactTieKey: "tie",
          resolution: "shared_rank",
          memberIds: [memberId, "40000000-0000-4000-8000-000000000001"],
          rationale: "",
        },
      ],
      awards: [],
    };
    await expect(POST(request())).rejects.toMatchObject({
      code: "invalid_operator_action",
      status: 400,
    });
    expect(mocks.finalizeRound).not.toHaveBeenCalled();
  });
});
