// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  body: {
    acceptedInstructions: true,
    idempotencyKey: "claim-request-0001",
  } as Record<string, unknown>,
  claimAward: vi.fn(),
  memberContext: vi.fn(),
}));

vi.mock("@/competition/http", () => ({
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  boundedBody: vi.fn(async () => mocks.body),
  handle: async (action: () => Promise<NextResponse>) => action(),
  memberContext: mocks.memberContext,
  response: (body: unknown, status = 200) =>
    NextResponse.json(body, { status }),
}));
vi.mock("@/competition/operations-store", () => ({
  claimAward: mocks.claimAward,
}));

import { POST } from "@/app/api/competition/awards/[awardId]/claim/route";

const awardId = "10000000-0000-4000-8000-000000000001";
const memberId = "20000000-0000-4000-8000-000000000001";

function request() {
  return new NextRequest(
    `https://arcade.example.test/api/competition/awards/${awardId}/claim`,
    {
      method: "POST",
      body: "{}",
    },
  );
}

describe("competition award claim route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.body = {
      acceptedInstructions: true,
      idempotencyKey: "claim-request-0001",
    };
    mocks.memberContext.mockResolvedValue({
      db: { test: true },
      session: { memberId },
    });
    mocks.claimAward.mockResolvedValue({ status: "claimed", repeated: false });
  });

  it("claims only for the authenticated member with fixed proof", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ awardId }),
    });
    expect(response.status).toBe(200);
    expect(mocks.memberContext).toHaveBeenCalledWith(expect.anything(), {
      mutation: true,
    });
    expect(mocks.claimAward).toHaveBeenCalledWith(
      { test: true },
      {
        awardId,
        memberId,
        proof: { acceptedInstructions: true },
        idempotencyKey: "claim-request-0001",
      },
    );
  });

  it.each([
    { acceptedInstructions: false, idempotencyKey: "claim-request-0001" },
    { acceptedInstructions: true, idempotencyKey: "short" },
    {
      acceptedInstructions: true,
      idempotencyKey: "claim-request-0001",
      contact: "private@example.test",
    },
  ])("rejects malformed or additional claim fields", async (body) => {
    mocks.body = body;
    await expect(
      POST(request(), { params: Promise.resolve({ awardId }) }),
    ).rejects.toMatchObject({ code: "invalid_claim", status: 400 });
    expect(mocks.claimAward).not.toHaveBeenCalled();
  });
});
