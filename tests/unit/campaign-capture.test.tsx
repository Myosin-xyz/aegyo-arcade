/**
 * MOUNTED CampaignCapture activity wiring (M3 review P1: the unit
 * vectors previously touched the session by hand — these test the
 * production component): pointer/keyboard activity and client
 * navigation must update `lastActivityAt`, throttled input must not
 * write every event, and touches must never create a session.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ACTIVITY_THROTTLE_MS, CampaignCapture } from "@/app/campaign-capture";
import {
  CAMPAIGN_STORAGE_KEY,
  getStoredCampaign,
  storeCampaign,
} from "@/shell/campaign";

/** Simulate a Next client transition: jsdom URL + mocked hook values. */
function navigate(pathname: string, search: string): void {
  mockPathname = pathname;
  mockSearch = search;
  window.history.replaceState(
    null,
    "",
    `${pathname}${search ? `?${search}` : ""}`,
  );
}

let mockPathname = "/";
let mockSearch = "";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

const T0 = 1_800_000_000_000;
const MIN = 60_000;

function lastActivityAt(): number | null {
  const raw = sessionStorage.getItem(CAMPAIGN_STORAGE_KEY);
  if (raw === null) return null;
  return (JSON.parse(raw) as { lastActivityAt: number }).lastActivityAt;
}

describe("CampaignCapture — production activity touches", () => {
  let container: HTMLDivElement;
  let root: Root;
  let clock: number;

  beforeEach(() => {
    clock = T0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    mockPathname = "/";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  async function mount(): Promise<void> {
    await act(async () => {
      root.render(<CampaignCapture />);
    });
  }

  it("pointer and keyboard activity update lastActivityAt (throttled)", async () => {
    storeCampaign({ utm_source: "tiktok" }, T0);
    await mount();
    clock = T0 + 10 * MIN;
    window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(lastActivityAt()).toBe(T0 + 10 * MIN);

    // Within the throttle window: no extra write.
    clock = T0 + 10 * MIN + ACTIVITY_THROTTLE_MS / 2;
    window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(lastActivityAt()).toBe(T0 + 10 * MIN);

    // Past the throttle window, keyboard counts too.
    clock = T0 + 12 * MIN;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp" }));
    expect(lastActivityAt()).toBe(T0 + 12 * MIN);
  });

  it("continuous activity carries attribution past wall-clock 30 minutes", async () => {
    storeCampaign({ utm_source: "tiktok" }, T0);
    await mount();
    for (let minute = 10; minute <= 50; minute += 10) {
      clock = T0 + minute * MIN;
      window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    }
    // 50 wall-clock minutes, never >30 idle → still attributed.
    expect(lastActivityAt()).toBe(T0 + 50 * MIN);
  });

  it("client navigation (pathname change) touches the session AND strips residue", async () => {
    storeCampaign({ utm_source: "tiktok" }, T0);
    await mount();
    clock = T0 + 15 * MIN;
    navigate("/play/snake", "utm_source=youtube&fbclid=f1");
    await act(async () => {
      root.render(<CampaignCapture />);
    });
    expect(lastActivityAt()).toBe(T0 + 15 * MIN);
    expect(getStoredCampaign(clock)).toEqual({ utm_source: "tiktok" }); // first touch holds
    expect(window.location.search).toBe(""); // residue stripped post-navigation
  });

  it("QUERY-ONLY client navigation touches the session and strips residue (M3 review P2)", async () => {
    storeCampaign({ utm_source: "tiktok" }, T0);
    await mount();
    clock = T0 + 12 * MIN;
    navigate("/", "utm_source=instagram&gclid=g1&keep=1");
    await act(async () => {
      root.render(<CampaignCapture />);
    });
    expect(lastActivityAt()).toBe(T0 + 12 * MIN); // query change = activity
    expect(getStoredCampaign(clock)).toEqual({ utm_source: "tiktok" });
    expect(window.location.search).toBe("?keep=1"); // utm + gclid gone
  });

  it("navigation after the idle boundary RE-ATTRIBUTES via the route-change capture", async () => {
    storeCampaign({ utm_source: "tiktok" }, T0);
    await mount();
    clock = T0 + 31 * MIN;
    navigate("/", "utm_source=youtube");
    await act(async () => {
      root.render(<CampaignCapture />);
    });
    expect(getStoredCampaign(clock)).toEqual({ utm_source: "youtube" });
  });

  it("activity never CREATES a session from nothing", async () => {
    await mount();
    clock = T0 + 5 * MIN;
    window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(sessionStorage.getItem(CAMPAIGN_STORAGE_KEY)).toBeNull();
  });
});
