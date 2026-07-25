/**
 * LocaleBoundary (M4 review P1): the first render is `en` (matching the
 * server), then the resolved device preference flips the locale and
 * REMOUNTS the subtree so text AND attributes re-render localized.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LocaleBoundary } from "@/app/locale-boundary";
import { LOCALE_STORAGE_KEY, setLocale, t } from "@/i18n/t";

function Probe() {
  return (
    <button type="button" aria-label={t("host.back")}>
      {t("host.practice")}
    </button>
  );
}

describe("LocaleBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    setLocale("en");
    document.documentElement.lang = "en";
  });

  it("stored es-419 → subtree remounts localized (text + aria) and <html lang> updates", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "es-419");
    await act(async () => {
      root.render(
        <LocaleBoundary>
          <Probe />
        </LocaleBoundary>,
      );
    });
    const probe = container.querySelector("button")!;
    expect(probe.textContent).toBe("Práctica");
    expect(probe.getAttribute("aria-label")).toBe("Volver a Aegyo Arena");
    expect(document.documentElement.lang).toBe("es-419");
  });

  it("no stored preference on an en device stays en with lang synced", async () => {
    await act(async () => {
      root.render(
        <LocaleBoundary>
          <Probe />
        </LocaleBoundary>,
      );
    });
    const probe = container.querySelector("button")!;
    expect(probe.textContent).toBe("Practice");
    expect(probe.getAttribute("aria-label")).toBe("Back to Aegyo Arena");
    expect(document.documentElement.lang).toBe("en");
  });
});
