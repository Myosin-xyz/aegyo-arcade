/**
 * NON-DESTRUCTIVE claw asset budget check (TECH_SPEC §7.1.5, M1 review B7).
 * Reads the committed manifest + WebP set and verifies, without modifying
 * anything:
 *   - every referenced sprite file exists,
 *   - decoded RGBA total ≤ 32 MiB (dimension-derived),
 *   - transfer total ≤ 350 KB,
 *   - the manifest design box matches the registered GameMeta expectation.
 * Run in CI after build; exit 1 on violation.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSET_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "games",
  "claw",
);
const DECODED_BUDGET = 32 * 1024 * 1024;
const TRANSFER_BUDGET = 350 * 1024;
const EXPECTED_DESIGN = { w: 941, h: 1488 }; // mirrors src/games/claw/meta.ts

const manifest = JSON.parse(
  readFileSync(path.join(ASSET_DIR, "manifest.json"), "utf8"),
);

const rects = [];
(function walk(node) {
  if (node && typeof node === "object") {
    if (
      "src" in node &&
      ["x", "y", "w", "h"].every((k) => typeof node[k] === "number")
    ) {
      rects.push(node);
    } else {
      for (const value of Object.values(node)) walk(value);
    }
  }
})(manifest);

let decoded = 0;
let transfer = 0;
const seen = new Set();
let missing = 0;
for (const rect of rects) {
  if (seen.has(rect.src)) continue;
  seen.add(rect.src);
  decoded += rect.w * rect.h * 4;
  try {
    transfer += statSync(path.join(ASSET_DIR, rect.src)).size;
  } catch {
    console.error(`MISSING sprite file: ${rect.src}`);
    missing += 1;
  }
}

// Stale generated sprites (review P2): the exporter/rescaler never delete
// files a NEWER manifest stopped referencing (e.g. claw-plush-excl.webp
// after the V3 export dropped it), so they would keep shipping while
// staying invisible to the budget above. Fail on any unreferenced image.
const stale = readdirSync(ASSET_DIR)
  .filter((f) => /\.(webp|png)$/i.test(f))
  .filter((f) => !seen.has(f));
for (const file of stale) {
  console.error(
    `STALE unreferenced asset (delete it or re-export cleanly): ${file}`,
  );
}

const designOk =
  manifest.design?.w === EXPECTED_DESIGN.w &&
  manifest.design?.h === EXPECTED_DESIGN.h;

console.log(
  `claw assets: ${seen.size} sprites, decoded ${(decoded / 1048576).toFixed(1)} MiB ` +
    `(budget 32), transfer ${(transfer / 1024).toFixed(0)} KB (budget 350), ` +
    `design ${manifest.design?.w}x${manifest.design?.h}`,
);

if (
  missing > 0 ||
  stale.length > 0 ||
  decoded > DECODED_BUDGET ||
  transfer > TRANSFER_BUDGET ||
  !designOk
) {
  console.error("CLAW ASSET BUDGET CHECK FAILED");
  process.exit(1);
}
