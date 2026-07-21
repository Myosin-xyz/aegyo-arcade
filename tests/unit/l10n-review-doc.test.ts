/**
 * EXT-LOCALE pack drift check (review P2, 2026-07-19): the committed
 * review document must match the live locale JSONs at the VALUE level —
 * key-only parity let the pack go stale, and a native reviewer would
 * have approved copy that no longer ships. Regenerate with
 * `node scripts/ops/generate-l10n-review.mjs && pnpm format`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es-419.json";
import { buildReviewDoc } from "../../scripts/ops/generate-l10n-review.mjs";

const DOC = path.resolve(__dirname, "../../docs/l10n-review-es-419.md");

function parseRows(markdown: string): Map<string, { en: string; es: string }> {
  const rows = new Map<string, { en: string; es: string }>();
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\| `([^`]+)` +\|(.*)\|(.*)\|\s*$/);
    if (!match) continue;
    if (rows.has(match[1])) {
      throw new Error(`duplicate row for key ${match[1]} — regenerate the doc`);
    }
    rows.set(match[1], { en: match[2].trim(), es: match[3].trim() });
  }
  return rows;
}

describe("l10n review pack", () => {
  const doc = parseRows(readFileSync(DOC, "utf8"));
  const enMap = en as Record<string, string>;
  const esMap = es as Record<string, string>;

  it("covers exactly the shipped keys", () => {
    expect([...doc.keys()].sort()).toEqual(Object.keys(enMap).sort());
  });

  it("matches every EN and es-419 VALUE (no stale copy for the reviewer)", () => {
    const mismatches: string[] = [];
    for (const [key, row] of doc) {
      if (row.en !== enMap[key]) {
        mismatches.push(`${key} EN: doc="${row.en}" json="${enMap[key]}"`);
      }
      if (row.es !== esMap[key]) {
        mismatches.push(`${key} ES: doc="${row.es}" json="${esMap[key]}"`);
      }
    }
    expect(mismatches, mismatches.join("\n")).toEqual([]);
  });
});

describe("buildReviewDoc guards", () => {
  it("throws when a value contains a table-breaking pipe", () => {
    expect(() =>
      buildReviewDoc({ "a.key": "safe | broken" }, { "a.key": "seguro" }),
    ).toThrow(/table-breaking character/);
  });

  it("throws when a value contains a table-breaking backtick", () => {
    expect(() =>
      buildReviewDoc({ "a.key": "safe" }, { "a.key": "roto `code`" }),
    ).toThrow(/table-breaking character/);
  });

  it("throws on locale key drift in either direction", () => {
    // en has a key es lacks
    expect(() =>
      buildReviewDoc({ "a.key": "x", "b.key": "y" }, { "a.key": "x" }),
    ).toThrow(/key drift/);
    // es has a key en lacks
    expect(() =>
      buildReviewDoc({ "a.key": "x" }, { "a.key": "x", "b.key": "y" }),
    ).toThrow(/key drift/);
  });
});
