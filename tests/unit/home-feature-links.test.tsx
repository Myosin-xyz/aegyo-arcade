import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/streak-strip", () => ({ StreakStrip: () => null }));
vi.mock("@/app/locale-toggle", () => ({ LocaleToggle: () => null }));
vi.mock("@/app/logo", () => ({ AegyoLogo: () => <span /> }));

import { HomeContent } from "@/app/home-content";

function render(sharedAuthEnabled: boolean, competitionEnabled: boolean) {
  return renderToStaticMarkup(
    <HomeContent
      gameOrder={[]}
      sharedAuthEnabled={sharedAuthEnabled}
      competitionEnabled={competitionEnabled}
    />,
  );
}

describe("homepage feature discovery", () => {
  it("preserves the prior homepage when both flags are off", () => {
    const html = render(false, false);
    expect(html).not.toContain('href="/account"');
    expect(html).not.toContain('href="/championship"');
  });

  it("exposes each enabled feature independently", () => {
    expect(render(true, false)).toContain('href="/account"');
    expect(render(true, false)).not.toContain('href="/championship"');
    expect(render(false, true)).toContain('href="/championship"');
    expect(render(false, true)).not.toContain('href="/account"');
  });
});
