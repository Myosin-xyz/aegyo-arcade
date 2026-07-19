/**
 * Fan Day: This or That — accessible DOM module (M4.5 prototype,
 * hangman's proven contract pattern): real buttons, ONE delegated click
 * listener, keyboard via the InputBus (←/→ pick a side), polite
 * aria-live progress + concise result summary, pause disables
 * everything, idempotent teardown. Reaching the result reports
 * `end("completed")` ONCE through the frozen lifecycle; the registry's
 * `endPresentation: "game-authored"` keeps the in-DOM result visible
 * and the HOST owns Play Again (fresh RunContext — M4.5 review P1).
 */

import type {
  GameContext,
  GameDefinition,
  RunContext,
  ShellLoopGame,
} from "@/shell/contract";
import { thisorthatMeta } from "./meta";
import { TOT_ROUNDS, VIBE_COLORS, VIBE_GLYPHS, type Vibe } from "./content";
import {
  TOTAL_ROUNDS,
  choose,
  createTotState,
  optionFor,
  resultVibe,
  type TotSide,
  type TotState,
} from "./logic";
import { arp, blip } from "@/shell/sfx-presets";

/** Ignore taps landing within this window after a choice — a double
 * tap must advance exactly once, never skip a round (acceptance bar). */
export const CHOICE_LOCK_MS = 300;

const SVG_NS = "http://www.w3.org/2000/svg";

/** Safe DOM construction throughout (no innerHTML — repo standard). */
function makeGlyph(vibe: Vibe, size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", VIBE_COLORS[vibe]);
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", VIBE_GLYPHS[vibe]);
  svg.appendChild(path);
  return svg;
}

class ThisOrThatGame implements ShellLoopGame {
  readonly loop = "shell" as const;
  private state: TotState | null = null;
  private paused = false;
  private endedReported = false;
  /** Null = no choice yet — 0 is a VALID performance.now() value and
   * would reject a legitimate first tap (M4.5 review P3). */
  private lastChoiceAt: number | null = null;
  private root: HTMLElement | null = null;
  private refs: {
    progress: HTMLElement;
    pick: HTMLElement;
    cards: [HTMLButtonElement, HTMLButtonElement];
    result: HTMLElement;
    summary: HTMLElement;
    resultVibe: HTMLElement;
    recap: HTMLElement;
  } | null = null;
  private readonly onRootClick = (event: Event) => {
    if (this.paused) return;
    const target = event.target as HTMLElement;
    const card = target.closest?.("button[data-side]");
    if (card instanceof HTMLButtonElement && !card.disabled) {
      this.applyChoice(Number(card.dataset.side) as TotSide);
    }
  };
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    if (this.ctx.surface.kind !== "dom") {
      throw new Error("thisorthat requires a dom surface");
    }
    this.ctx.audio.register("pick", blip(720, 0.05, "triangle", 0.04));
    this.ctx.audio.register("result", arp([523, 659, 784, 1047], 0.07));
    const root = this.ctx.surface.root;
    this.root = root;
    const t = this.ctx.t;

    root.replaceChildren();
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "display:flex;flex-direction:column;gap:14px;align-items:center;" +
      "padding:20px 14px;max-width:420px;margin:0 auto;color:inherit;";

    const progress = document.createElement("p");
    progress.dataset.testid = "tot-progress";
    progress.setAttribute("aria-live", "polite");
    progress.style.cssText =
      "margin:0;font-size:13px;font-weight:700;letter-spacing:0.08em;" +
      "color:var(--gold);";

    const pick = document.createElement("p");
    pick.textContent = t("game.thisorthat.pick");
    pick.style.cssText = "margin:0;font-size:16px;font-weight:800;";

    const cardsWrap = document.createElement("div");
    cardsWrap.style.cssText =
      "display:flex;flex-direction:column;gap:12px;width:100%;";
    const cards = [0, 1].map((side) => {
      const card = document.createElement("button");
      card.type = "button";
      card.dataset.side = String(side);
      card.dataset.testid = `tot-card-${side}`;
      card.style.cssText =
        "display:flex;align-items:center;gap:14px;width:100%;" +
        "min-height:96px;padding:16px;border-radius:16px;cursor:pointer;" +
        "border:1px solid var(--line);background:var(--surface);" +
        "color:inherit;font-size:17px;font-weight:700;text-align:left;";
      cardsWrap.appendChild(card);
      return card;
    }) as [HTMLButtonElement, HTMLButtonElement];

    // Ordinary container — a live region must NOT wrap the whole result
    // (nine recap items + controls); the concise summary below carries
    // role="status" instead (M4.5 review P2).
    const result = document.createElement("div");
    result.dataset.testid = "tot-result";
    result.style.cssText =
      "display:none;flex-direction:column;gap:12px;width:100%;" +
      "align-items:center;text-align:center;";
    const summary = document.createElement("p");
    summary.dataset.testid = "tot-summary";
    summary.setAttribute("role", "status");
    summary.setAttribute("aria-live", "polite");
    summary.textContent = t("game.thisorthat.resultTitle");
    summary.style.cssText = "margin:0;font-size:14px;color:var(--muted);";
    const resultVibeEl = document.createElement("div");
    resultVibeEl.style.cssText =
      "display:flex;flex-direction:column;gap:6px;align-items:center;";
    const recapTitle = document.createElement("p");
    recapTitle.textContent = t("game.thisorthat.recapTitle");
    recapTitle.style.cssText =
      "margin:10px 0 0;font-size:13px;font-weight:700;color:var(--muted);";
    const recap = document.createElement("ol");
    recap.style.cssText =
      "margin:0;padding:0 0 0 20px;font-size:14px;text-align:left;" +
      "display:flex;flex-direction:column;gap:4px;";
    result.append(summary, resultVibeEl, recapTitle, recap);

    wrap.append(progress, pick, cardsWrap, result);
    root.appendChild(wrap);
    this.refs = {
      progress,
      pick,
      cards,
      result,
      summary,
      resultVibe: resultVibeEl,
      recap,
    };

    root.addEventListener("click", this.onRootClick);
    this.unsubscribers.push(
      this.ctx.input.onKey((k) => {
        if (k.action !== "down" || this.paused) return;
        if (k.code === "ArrowLeft") this.applyChoice(0);
        if (k.code === "ArrowRight") this.applyChoice(1);
      }),
    );
  }

  start(_run: RunContext): void {
    // The HOST owns restart (fresh RunContext); each start is a full
    // clean reset of this instance.
    this.state = createTotState();
    this.endedReported = false;
    this.lastChoiceAt = null;
    this.renderRound();
  }

  pause(): void {
    this.paused = true;
    this.refreshDisabled();
  }

  resume(): void {
    this.paused = false;
    this.refreshDisabled();
  }

  update(): void {
    // Turn-based: nothing advances with time.
  }

  render(): void {
    // DOM is updated directly by input handlers.
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.root?.removeEventListener("click", this.onRootClick);
    this.root?.replaceChildren();
    this.root = null;
    this.refs = null;
    this.state = null;
  }

  private applyChoice(side: TotSide): void {
    const state = this.state;
    if (!state || this.paused) return;
    const now = performance.now();
    if (this.lastChoiceAt !== null && now - this.lastChoiceAt < CHOICE_LOCK_MS)
      return; // double-tap guard
    if (!choose(state, side)) return; // result screen: cards are gone
    this.lastChoiceAt = now; // only ACCEPTED choices arm the lock
    const done = state.choices.length >= TOTAL_ROUNDS;
    this.ctx.audio.play(done ? "result" : "pick");
    if (done) {
      this.renderResult();
      // Terminal through the FROZEN lifecycle, exactly once (M4.5
      // review P1) — the host keeps the result visible via the
      // registry's game-authored end presentation.
      if (!this.endedReported) {
        this.endedReported = true;
        this.ctx.report.end({ reason: "completed" });
      }
    } else {
      this.renderRound();
    }
  }

  private refreshDisabled(): void {
    if (!this.refs) return;
    for (const card of this.refs.cards) card.disabled = this.paused;
  }

  private renderRound(): void {
    const { refs, state } = this;
    if (!refs || !state) return;
    const t = this.ctx.t;
    refs.result.style.display = "none";
    refs.pick.style.display = "";
    for (const card of refs.cards) card.style.display = "";
    refs.progress.textContent = t("game.thisorthat.progress", {
      round: state.round + 1,
      total: TOTAL_ROUNDS,
    });
    ([0, 1] as const).forEach((side) => {
      const option = optionFor(state.round, side);
      const card = refs.cards[side];
      const label = document.createElement("span");
      label.textContent = t(`game.thisorthat.opt.${option.key}`);
      card.replaceChildren(makeGlyph(option.tags[0], 34), label);
    });
    this.refreshDisabled();
  }

  private renderResult(): void {
    const { refs, state } = this;
    if (!refs || !state) return;
    const t = this.ctx.t;
    const vibe = resultVibe(state.choices);
    refs.summary.textContent = `${t("game.thisorthat.resultTitle")} ${t(
      `game.thisorthat.vibe.${vibe}.name`,
    )}`;
    refs.pick.style.display = "none";
    for (const card of refs.cards) card.style.display = "none";
    refs.progress.textContent = t("game.thisorthat.progress", {
      round: TOTAL_ROUNDS,
      total: TOTAL_ROUNDS,
    });
    const vibeName = document.createElement("p");
    vibeName.textContent = t(`game.thisorthat.vibe.${vibe}.name`);
    vibeName.style.cssText = `margin:0;font-size:24px;font-weight:800;color:${VIBE_COLORS[vibe]};`;
    const vibeBlurb = document.createElement("p");
    vibeBlurb.textContent = t(`game.thisorthat.vibe.${vibe}.blurb`);
    vibeBlurb.style.cssText =
      "margin:0;font-size:14px;color:var(--muted);max-width:300px;";
    refs.resultVibe.replaceChildren(makeGlyph(vibe, 52), vibeName, vibeBlurb);
    refs.recap.replaceChildren(
      ...state.choices.map((side, round) => {
        const item = document.createElement("li");
        item.textContent = t(
          `game.thisorthat.opt.${optionFor(round, side).key}`,
        );
        return item;
      }),
    );
    refs.result.style.display = "flex";
    this.refreshDisabled();
  }
}

export const thisorthatDefinition: GameDefinition = {
  apiVersion: 1,
  meta: thisorthatMeta,
  create(ctx: GameContext) {
    return new ThisOrThatGame(ctx);
  },
};

/** Content sanity: every round referenced by the module exists. */
if (TOT_ROUNDS.length !== TOTAL_ROUNDS) {
  throw new Error("thisorthat content/rounds mismatch");
}
