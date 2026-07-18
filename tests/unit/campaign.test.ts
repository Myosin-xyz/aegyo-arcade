/**
 * Campaign attribution vectors (TECH_SPEC §16 required test, OD-7,
 * §17.2): name/value allowlist, stripping of utm_* AND recognized click
 * IDs, and the 30-minute-inactivity session envelope — first touch wins
 * INSIDE a session, the 29/31-minute boundary decides re-attribution,
 * and activity touches extend the window.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  CAMPAIGN_STORAGE_KEY,
  SESSION_IDLE_MS,
  getStoredCampaign,
  normalizeCampaignValue,
  parseCampaign,
  storeCampaign,
  stripCampaignParams,
} from "@/shell/campaign";

const T0 = 1_800_000_000_000;
const MIN = 60_000;

afterEach(() => {
  sessionStorage.clear();
});

describe("campaign — parameter allowlist", () => {
  it("keeps only allowlisted names with valid values", () => {
    expect(
      parseCampaign(
        "?utm_source=tiktok&utm_medium=paid&utm_campaign=kbw_teaser" +
          "&utm_term=free-form text!&utm_content=x&gclid=abc123&foo=bar",
      ),
    ).toEqual({
      utm_source: "tiktok",
      utm_medium: "paid",
      utm_campaign: "kbw_teaser",
    });
  });

  it("rejects unexpected VALUES even under allowlisted names", () => {
    expect(parseCampaign("?utm_campaign=hello world")).toEqual({});
    expect(parseCampaign("?utm_campaign=https://evil.example")).toEqual({});
    expect(parseCampaign("?utm_campaign=%3Cscript%3E")).toEqual({});
    expect(parseCampaign(`?utm_campaign=${"a".repeat(65)}`)).toEqual({});
    expect(parseCampaign("?utm_campaign=_leading-separator")).toEqual({});
    expect(parseCampaign("?utm_campaign=")).toEqual({});
  });

  it("normalizes case-sloppy campaign tooling", () => {
    expect(normalizeCampaignValue("  KBW_Teaser ")).toBe("kbw_teaser");
    expect(parseCampaign("?utm_source=TikTok")).toEqual({
      utm_source: "tiktok",
    });
  });
});

describe("campaign — URL stripping", () => {
  it("removes utm_* AND recognized click IDs; preserves the rest (M3 review P2)", () => {
    const cleaned = stripCampaignParams(
      new URL(
        "https://arcade.aegyoarena.com/play/snake" +
          "?utm_source=x&UTM_TERM=y&keep=1&utm_whatever=z" +
          "&gclid=g123&fbclid=f456&ttclid=t789&msclkid=m1&GCLID=up",
      ),
    );
    expect(cleaned).toBe("https://arcade.aegyoarena.com/play/snake?keep=1");
  });

  it("returns null when there is nothing to strip (no history rewrite)", () => {
    expect(
      stripCampaignParams(new URL("https://arcade.aegyoarena.com/?keep=1")),
    ).toBeNull();
  });
});

describe("campaign — §17.2 session envelope (30-min inactivity)", () => {
  it("first touch wins INSIDE a session: 29 minutes later, TikTok still owns it", () => {
    storeCampaign(parseCampaign("?utm_source=tiktok&utm_campaign=launch"), T0);
    storeCampaign(parseCampaign("?utm_source=instagram"), T0 + 29 * MIN);
    expect(getStoredCampaign(T0 + 29 * MIN)).toEqual({
      utm_source: "tiktok",
      utm_campaign: "launch",
    });
  });

  it("31 minutes idle → NEW session: Instagram re-attributes", () => {
    storeCampaign(parseCampaign("?utm_source=tiktok"), T0);
    storeCampaign(parseCampaign("?utm_source=instagram"), T0 + 31 * MIN);
    expect(getStoredCampaign(T0 + 31 * MIN)).toEqual({
      utm_source: "instagram",
    });
  });

  it("activity EXTENDS the window: 20-min touches keep the session alive past wall-clock 40min", () => {
    storeCampaign(parseCampaign("?utm_source=tiktok"), T0);
    storeCampaign({}, T0 + 20 * MIN); // plain navigation, no params
    storeCampaign(parseCampaign("?utm_source=instagram"), T0 + 40 * MIN);
    // Only 20min since last activity → same session → first touch wins.
    expect(getStoredCampaign(T0 + 40 * MIN)).toEqual({
      utm_source: "tiktok",
    });
  });

  it("idle-expired attribution reads as null and the READ ALONE clears residue", () => {
    storeCampaign(parseCampaign("?utm_source=tiktok"), T0);
    expect(getStoredCampaign(T0 + SESSION_IDLE_MS + 1)).toBeNull();
    // No subsequent store needed — the read cleared it (M3 review P2).
    expect(sessionStorage.getItem(CAMPAIGN_STORAGE_KEY)).toBeNull();
  });

  it("stores nothing for empty/invalid captures", () => {
    storeCampaign(parseCampaign("?utm_campaign=bad value&gclid=x"), T0);
    expect(sessionStorage.getItem(CAMPAIGN_STORAGE_KEY)).toBeNull();
    expect(getStoredCampaign(T0)).toBeNull();
  });

  it("hostile stored payloads are re-validated on read", () => {
    sessionStorage.setItem(
      CAMPAIGN_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        lastActivityAt: T0,
        campaign: {
          utm_source: "ok_value",
          utm_campaign: "<script>alert(1)</script>",
          not_allowlisted: "x",
        },
      }),
    );
    expect(getStoredCampaign(T0 + 1)).toEqual({ utm_source: "ok_value" });
    sessionStorage.setItem(CAMPAIGN_STORAGE_KEY, "not json {");
    expect(getStoredCampaign(T0)).toBeNull();
    expect(sessionStorage.getItem(CAMPAIGN_STORAGE_KEY)).toBeNull(); // read cleared it
    // Unversioned / malformed envelopes never attribute — and are
    // cleared by the read alone.
    sessionStorage.setItem(
      CAMPAIGN_STORAGE_KEY,
      JSON.stringify({ utm_source: "legacy_flat_shape" }),
    );
    expect(getStoredCampaign(T0)).toBeNull();
    expect(sessionStorage.getItem(CAMPAIGN_STORAGE_KEY)).toBeNull();
  });
});
