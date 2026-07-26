/**
 * Guess the Slang — first production DOM-surface game (docs/games/
 * hangman.md) and the dom-side contract compatibility check (ADR 0001).
 *
 * Real buttons with focus states, ONE delegated click listener on the
 * root (leak-free teardown), physical-keyboard guesses via the InputBus,
 * and a polite aria-live status line. Pause gates both paths: the host
 * disables the InputBus, and the delegated handler + button disabled
 * states cover the DOM side.
 */

import type {
  GameContext,
  GameDefinition,
  RunContext,
  ShellLoopGame,
} from "@/shell/contract";
import { hangmanMeta } from "./meta";
import { HANGMAN_TERMS, MAX_LIVES } from "./content";
import {
  createHangmanState,
  guess,
  revealedWord,
  scoreOf,
  type HangmanState,
} from "./logic";
import { arp, blip, sweep, thud } from "@/shell/sfx-presets";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

class HangmanGame implements ShellLoopGame {
  // Shell loop kept for uniformity; update/render are trivial for a
  // turn-based DOM game (state changes happen in input handlers).
  readonly loop = "shell" as const;
  private state: HangmanState | null = null;
  private paused = false;
  private endedReported = false;
  private root: HTMLElement | null = null;
  private refs: {
    hint: HTMLElement;
    word: HTMLElement;
    lives: HTMLElement;
    status: HTMLElement;
    keyboard: HTMLElement;
  } | null = null;
  private readonly onRootClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest?.(
      "button[data-letter]",
    ) as HTMLButtonElement | null;
    if (!button || this.paused) return;
    this.applyGuess(button.dataset.letter ?? "");
  };
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {}

  init(): void {
    this.ctx.audio.register("good", blip(784, 0.07, "triangle", 0.045));
    this.ctx.audio.register("bad", thud(160, 0.12, 0.05));
    this.ctx.audio.register("win", arp([523, 659, 784, 1047]));
    this.ctx.audio.register("lose", sweep(400, 80, 0.35, "sawtooth", 0.04));
    if (this.ctx.surface.kind !== "dom") {
      throw new Error("hangman requires a dom surface");
    }
    const root = this.ctx.surface.root;
    this.root = root;
    const t = this.ctx.t;

    root.replaceChildren();
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "display:flex;flex-direction:column;gap:16px;align-items:center;" +
      "padding:24px 16px;max-width:420px;margin:0 auto;color:inherit;";

    const hint = document.createElement("p");
    hint.style.cssText = "font-size:15px;text-align:center;margin:0;";
    const word = document.createElement("div");
    // Responsive so long words (COMEBACK, ULZZANG) don't overflow the
    // ~288px content box at 320px (audit B4); clamp + em spacing scale
    // together, break-word wraps if it still can't fit.
    word.style.cssText =
      "font-size:clamp(20px, 6.5vw, 28px);font-weight:800;" +
      "letter-spacing:0.25em;text-align:center;min-height:40px;" +
      "max-width:100%;overflow-wrap:break-word;word-break:break-word;";
    const lives = document.createElement("p");
    lives.style.cssText = "font-size:14px;margin:0;";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.style.cssText = "font-size:14px;min-height:20px;margin:0;";
    const keyboard = document.createElement("div");
    keyboard.setAttribute("aria-label", t("game.hangman.keyboardLabel"));
    keyboard.style.cssText =
      "display:flex;flex-wrap:wrap;gap:4px;justify-content:center;";
    for (const letter of LETTERS) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.letter = letter;
      button.textContent = letter;
      // 44×44 minimum touch target (iOS HIG / WCAG 2.5.5) — was 34×40.
      // At the 320px floor the content box is ~288px, which fits 6 keys
      // and 5 gaps (6·44 + 5·4 = 284). `flex:0 0 auto` stops flex-wrap
      // from shrinking a key back under the minimum on a narrower box.
      button.style.cssText =
        "flex:0 0 auto;width:44px;height:44px;border-radius:8px;" +
        "border:1px solid currentColor;background:transparent;" +
        "color:inherit;font-weight:700;cursor:pointer;";
      keyboard.appendChild(button);
    }

    wrap.append(hint, word, lives, status, keyboard);
    root.appendChild(wrap);
    this.refs = { hint, word, lives, status, keyboard };

    root.addEventListener("click", this.onRootClick);
    this.unsubscribers.push(
      this.ctx.input.onKey((k) => {
        if (k.action !== "down" || this.paused) return;
        const match = /^Key([A-Z])$/.exec(k.code);
        if (match) this.applyGuess(match[1]);
      }),
    );
  }

  start(run: RunContext): void {
    this.state = createHangmanState(run.random);
    this.endedReported = false;
    this.ctx.report.score(0);
    this.renderState();
    this.setStatus("");
  }

  pause(): void {
    this.paused = true;
    this.refreshKeyboard();
  }

  resume(): void {
    this.paused = false;
    this.refreshKeyboard();
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

  private applyGuess(letter: string): void {
    const state = this.state;
    if (!state) return;
    const result = guess(state, letter);
    const t = this.ctx.t;
    this.renderState();
    if (result.kind === "correct") {
      this.ctx.audio.play(result.solved ? "win" : "good");
    } else if (result.kind === "wrong") {
      this.ctx.audio.play(result.lost ? "lose" : "bad");
    }

    switch (result.kind) {
      case "ignored":
        return;
      case "repeat":
        this.setStatus(
          t("game.hangman.status.repeat", { letter: result.letter }),
        );
        return;
      case "correct":
        if (result.solved) {
          this.ctx.report.score(scoreOf(state));
          this.setStatus(
            t("game.hangman.status.solved", { lives: state.livesLeft }),
          );
          this.reportEndOnce("completed");
        } else {
          this.setStatus(
            t("game.hangman.status.correct", { letter: result.letter }),
          );
        }
        return;
      case "wrong":
        if (result.lost) {
          this.setStatus(t("game.hangman.status.lost", { term: state.term }));
          this.reportEndOnce("lost");
        } else {
          this.setStatus(
            t("game.hangman.status.wrong", { letter: result.letter }),
          );
        }
    }
  }

  private reportEndOnce(reason: "completed" | "lost"): void {
    if (this.endedReported) return;
    this.endedReported = true;
    this.refreshKeyboard();
    this.ctx.report.end({ reason });
  }

  private renderState(): void {
    const state = this.state;
    const refs = this.refs;
    if (!state || !refs) return;
    const t = this.ctx.t;
    refs.hint.textContent = t(HANGMAN_TERMS[state.termIndex].hintKey);
    const revealed = revealedWord(state);
    refs.word.textContent = revealed.map((letter) => letter ?? "_").join(" ");
    refs.word.setAttribute(
      "aria-label",
      revealed.map((letter) => letter ?? t("game.hangman.blank")).join(", "),
    );
    refs.lives.textContent = t("game.hangman.lives", {
      count: state.livesLeft,
      max: MAX_LIVES,
    });
    this.refreshKeyboard();
  }

  private refreshKeyboard(): void {
    const state = this.state;
    const refs = this.refs;
    if (!refs) return;
    const buttons = refs.keyboard.querySelectorAll<HTMLButtonElement>(
      "button[data-letter]",
    );
    for (const button of buttons) {
      const letter = button.dataset.letter ?? "";
      button.disabled =
        this.paused ||
        !state ||
        state.status !== "running" ||
        state.guessed.has(letter);
    }
  }

  private setStatus(text: string): void {
    if (this.refs) this.refs.status.textContent = text;
  }
}

export const hangmanDefinition: GameDefinition = {
  apiVersion: 1,
  meta: hangmanMeta,
  create(ctx: GameContext) {
    return new HangmanGame(ctx);
  },
};
