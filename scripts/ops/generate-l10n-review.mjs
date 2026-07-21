/**
 * Regenerates docs/l10n-review-es-419.md from the locale JSONs so the
 * EXT-LOCALE review pack can never drift from production copy (review
 * P2, 2026-07-19: the pack had gone stale after copy changes).
 * `tests/unit/l10n-review-doc.test.ts` enforces VALUE-level parity
 * between the committed doc and the JSONs — regenerate after any copy
 * change:
 *
 *   node scripts/ops/generate-l10n-review.mjs && pnpm format
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const OUT = path.join(ROOT, "docs/l10n-review-es-419.md");

export function buildReviewDoc(en, es) {
  const enOnly = Object.keys(en).filter((k) => !(k in es));
  const esOnly = Object.keys(es).filter((k) => !(k in en));
  if (enOnly.length || esOnly.length) {
    throw new Error(
      `locale key drift — missing in es-419: [${enOnly}] · orphaned in es-419: [${esOnly}]`,
    );
  }
  const keys = Object.keys(en).sort();
  for (const key of keys) {
    for (const value of [en[key], es[key]]) {
      if (value.includes("|") || value.includes("`")) {
        throw new Error(
          `locale value for ${key} contains a table-breaking character`,
        );
      }
    }
  }
  const rows = keys.map((key) => `| \`${key}\` | ${en[key]} | ${es[key]} |`);
  return [
    "# es-419 Native Review Pack (EXT-LOCALE gate)",
    "",
    `> Generated from src/i18n/locales (${keys.length} strings) by`,
    "> scripts/ops/generate-l10n-review.mjs — regenerate after ANY copy",
    "> change; a unit test pins this document to the JSON values.",
    "> LOCALE-1 requires a native/fan-fluent review before es-419 is",
    "> publicly enabled.",
    ">",
    "> **Reviewer instructions**: check neutral-LatAm tone (no",
    "> regionalisms that read wrong in MX/CO/AR/CL), natural gaming",
    "> register, and that K-pop fan lexicon STAYS in community-standard",
    "> English (bias, maknae, comeback, aegyo, fanchant, lightstick,",
    "> stan, merch, photocard, daebak — §12.1). Suggest edits inline;",
    "> engineering applies them as a translation-only diff (key parity",
    "> is CI-enforced).",
    "> The live ES preview is the fastest context: open the preview",
    "> link, tap ES in the home footer.",
    "",
    "| Key | EN | es-419 |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const en = JSON.parse(
    readFileSync(path.join(ROOT, "src/i18n/locales/en.json"), "utf8"),
  );
  const es = JSON.parse(
    readFileSync(path.join(ROOT, "src/i18n/locales/es-419.json"), "utf8"),
  );
  writeFileSync(OUT, buildReviewDoc(en, es));
  console.log(`wrote ${OUT} (${Object.keys(en).length} strings)`);
}
