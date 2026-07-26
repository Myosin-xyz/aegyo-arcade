/**
 * Locale parity (TECH_SPEC §12.1: "missing keys fail CI — a simple
 * static check"): every locale carries EXACTLY the en key set, and every
 * value's {placeholder} tokens match en's. Fan-lexicon spot checks pin
 * §12.1's "community-standard English form" rule.
 */

import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en.json";
import es419 from "@/i18n/locales/es-419.json";
import { LOCALES, t, setLocale, getLocale } from "@/i18n/t";

const DICTS: Record<string, Record<string, string>> = {
  en,
  "es-419": es419,
};

const tokens = (value: string): string[] =>
  [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n — locale parity", () => {
  it("every registered locale has a dictionary here", () => {
    for (const locale of LOCALES) expect(DICTS[locale]).toBeDefined();
  });

  for (const locale of LOCALES.filter((l) => l !== "en")) {
    it(`${locale}: exact key parity with en`, () => {
      const dict = DICTS[locale];
      expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort());
    });

    it(`${locale}: placeholder tokens match en per key`, () => {
      const dict = DICTS[locale];
      for (const key of Object.keys(en)) {
        expect(tokens(dict[key]), key).toEqual(
          tokens((en as Record<string, string>)[key]),
        );
      }
    });
  }

  it("fan lexicon stays in community-standard English (§12.1)", () => {
    const es = DICTS["es-419"];
    // "bias" replaced "lightstick" here when the flyer art changed
    // (2026-07-19) — the lexicon rule is the same: fan terms stay English.
    expect(es["game.flappy.controls"]).toContain("bias");
    // Snake Freebies (2026-07-26): the fan term in this tagline is
    // "freebies" — same §12.1 rule, current copy.
    expect(es["game.snake.tagline"]).toContain("freebies");
    expect(es["game.freebie.controls"]).toContain("merch");
    expect(es["game.freebie.rank.3"]).toBe("Bias Wrecker");
    expect(es["game.hangman.status.solved"]).toContain("Daebak");
  });

  it("setLocale switches t() and rejects unknown locales", () => {
    const before = getLocale();
    setLocale("es-419");
    expect(t("host.playAgain")).toBe("Jugar de nuevo");
    setLocale("xx-XX"); // rejected — stays es-419
    expect(t("host.playAgain")).toBe("Jugar de nuevo");
    setLocale("en");
    expect(t("host.playAgain")).toBe("Play again");
    setLocale(before);
  });
});
