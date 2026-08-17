import type {
  GameContext,
  GameDefinition,
  RunContext,
  ShellLoopGame,
} from "@/shell/contract";
import { arp, blip, thud } from "@/shell/sfx-presets";
import {
  CARD_ASPECT,
  FIXED_LIVES,
  LEVELS,
  SCORE_PER_PAIR_PER_LEVEL,
  continueBiasMatch,
  createBiasMatchState,
  formattedTime,
  pairCountForLevel,
  selectBiasMatchCard,
  stepBiasMatch,
  type BiasMatchState,
  type Rng,
} from "./logic";
import { biasMatchMeta } from "./meta";
import styles from "./styles.module.css";

const ASSET_BASE = "/games/bias-match/";
const ASSET_COUNT = 16;
const CARD_GAP = 7;

interface BiasMatchRefs {
  level: HTMLElement;
  score: HTMLElement;
  time: HTMLElement;
  lives: HTMLElement;
  boardWrap: HTMLElement;
  board: HTMLElement;
  toast: HTMLElement;
  status: HTMLElement;
  screen: HTMLElement;
  screenTitle: HTMLElement;
  screenStats: HTMLElement;
  continueButton: HTMLButtonElement;
}

function loadImage(
  src: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("bias-match init aborted", "AbortError"));
      return;
    }
    const image = new Image();
    const onAbort = () =>
      reject(new DOMException("bias-match init aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    image.onload = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(image);
    };
    image.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`bias-match asset failed: ${src}`));
    };
    image.src = src;
  });
}

function makeHudBox(label: string): {
  box: HTMLElement;
  value: HTMLElement;
} {
  const box = document.createElement("div");
  box.className = styles.hudBox;
  const labelElement = document.createElement("span");
  labelElement.className = styles.hudLabel;
  labelElement.textContent = label;
  const value = document.createElement("span");
  value.className = styles.hudValue;
  box.append(labelElement, value);
  return { box, value };
}

class BiasMatchGame implements ShellLoopGame {
  readonly loop = "shell" as const;
  private state: BiasMatchState | null = null;
  private rng: Rng | null = null;
  private root: HTMLElement | null = null;
  private refs: BiasMatchRefs | null = null;
  private cardButtons: HTMLButtonElement[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private paused = false;
  private endedReported = false;
  private lastWholeSecond = -1;
  private toastRemainingMs = 0;

  private readonly onRootClick = (event: Event) => {
    if (this.paused) return;
    const target = event.target as HTMLElement;
    const continueButton = target.closest?.("button[data-continue]");
    if (continueButton instanceof HTMLButtonElement) {
      this.continueLevel();
      return;
    }
    const card = target.closest?.("button[data-card-index]");
    if (card instanceof HTMLButtonElement && !card.disabled) {
      this.selectCard(Number(card.dataset.cardIndex));
    }
  };

  constructor(private readonly ctx: GameContext) {}

  async init(signal: AbortSignal): Promise<void> {
    if (this.ctx.surface.kind !== "dom") {
      throw new Error("bias-match requires a dom surface");
    }
    await Promise.all(
      Array.from({ length: ASSET_COUNT }, (_, index) =>
        loadImage(
          `${ASSET_BASE}face_${String(index).padStart(2, "0")}.webp`,
          signal,
        ),
      ),
    );

    this.ctx.audio.register("bias-match-flip", blip(620, 0.045, "triangle"));
    this.ctx.audio.register("bias-match-miss", thud(120, 0.16, 0.055));
    this.ctx.audio.register("bias-match-pair", arp([660, 880], 0.055));
    this.ctx.audio.register(
      "bias-match-gold",
      arp([660, 880, 1180], 0.055, 0.09),
    );
    this.ctx.audio.register(
      "bias-match-level",
      arp([523, 659, 784, 1047], 0.06),
    );
    this.ctx.audio.register("bias-match-lose", thud(82, 0.32, 0.07));

    this.root = this.ctx.surface.root;
    this.buildSurface();
    this.root.addEventListener("click", this.onRootClick);
    if (typeof ResizeObserver !== "undefined" && this.refs) {
      this.resizeObserver = new ResizeObserver(() => this.applyGeometry());
      this.resizeObserver.observe(this.refs.boardWrap);
    }
  }

  start(run: RunContext): void {
    this.rng = run.random;
    this.state = createBiasMatchState(run.random);
    this.paused = false;
    this.endedReported = false;
    this.lastWholeSecond = -1;
    this.toastRemainingMs = 0;
    this.clearFeedback();
    this.ctx.report.score(0);
    this.buildCards();
    this.renderAll();
  }

  pause(): void {
    this.paused = true;
    this.refreshCards();
    if (this.refs) this.refs.continueButton.disabled = true;
  }

  resume(): void {
    this.paused = false;
    this.refreshCards();
    if (this.refs) this.refs.continueButton.disabled = false;
  }

  update(dtMs: number): void {
    const state = this.state;
    if (!state || this.paused || this.endedReported) return;

    if (this.toastRemainingMs > 0) {
      this.toastRemainingMs -= dtMs;
      if (this.toastRemainingMs <= 0) this.hideToast();
    }

    const event = stepBiasMatch(state, dtMs);
    const wholeSecond = Math.floor(state.elapsedMs / 1000);
    if (wholeSecond !== this.lastWholeSecond) {
      this.lastWholeSecond = wholeSecond;
      this.renderHud();
    }
    if (event.changed) this.refreshCards();
    if (event.scoreChanged) {
      this.ctx.report.score(state.score);
      this.renderHud();
    }

    if (event.resolved === "mismatch") {
      this.showToast(this.ctx.t("game.bias-match.toast.miss"), "#ff5a7a");
      this.renderHud();
    } else if (event.resolved === "gold") {
      const points = SCORE_PER_PAIR_PER_LEVEL * state.level * 2;
      this.ctx.audio.play("bias-match-gold");
      this.showToast(
        this.ctx.t("game.bias-match.toast.gold", { points }),
        "#ffd24f",
      );
    } else if (event.resolved === "match") {
      this.ctx.audio.play("bias-match-pair");
      this.showToast(this.ctx.t("game.bias-match.toast.match"), "#4ff0ff");
    }

    if (event.levelCleared && !event.ended) {
      this.ctx.audio.play("bias-match-level");
      this.renderOverlay();
    }
    if (event.ended) {
      this.clearFeedback();
      this.ctx.audio.play(
        event.ended === "completed" ? "bias-match-level" : "bias-match-lose",
      );
      this.renderAll();
      this.endedReported = true;
      this.ctx.report.end({ reason: event.ended });
    }
  }

  render(): void {
    // Turn-based DOM game: input and discrete timers update the surface.
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.root?.removeEventListener("click", this.onRootClick);
    this.root?.replaceChildren();
    this.root = null;
    this.refs = null;
    this.cardButtons = [];
    this.state = null;
    this.rng = null;
  }

  private buildSurface(): void {
    const root = this.root;
    if (!root) return;
    const t = this.ctx.t;
    root.replaceChildren();

    const app = document.createElement("div");
    app.className = styles.app;
    const hud = document.createElement("div");
    hud.className = styles.hud;
    const level = makeHudBox(t("game.bias-match.hud.level"));
    const score = makeHudBox(t("game.bias-match.hud.score"));
    const time = makeHudBox(t("game.bias-match.hud.time"));
    hud.append(level.box, score.box, time.box);

    const lives = document.createElement("div");
    lives.className = styles.livesRow;
    lives.setAttribute("aria-label", t("game.bias-match.hud.lives"));

    const boardWrap = document.createElement("div");
    boardWrap.className = styles.boardWrap;
    boardWrap.dataset.testid = "bias-match-board-scroll";
    const board = document.createElement("div");
    board.className = styles.board;
    board.setAttribute("role", "group");
    board.setAttribute("aria-label", t("game.bias-match.boardLabel"));
    boardWrap.appendChild(board);

    const toast = document.createElement("div");
    toast.className = styles.toast;
    toast.setAttribute("aria-hidden", "true");
    const status = document.createElement("p");
    status.className = "sr-only";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const screen = document.createElement("div");
    screen.className = `${styles.screen} ${styles.hidden}`;
    screen.setAttribute("role", "status");
    screen.setAttribute("aria-live", "polite");
    const screenTitle = document.createElement("h2");
    screenTitle.className = styles.bigMessage;
    const screenStats = document.createElement("p");
    screenStats.className = styles.statsLine;
    const continueButton = document.createElement("button");
    continueButton.type = "button";
    continueButton.className = styles.continueButton;
    continueButton.dataset.continue = "true";
    continueButton.textContent = t("game.bias-match.continue");
    screen.append(screenTitle, screenStats, continueButton);

    app.append(hud, lives, boardWrap, toast, status, screen);
    root.appendChild(app);
    this.refs = {
      level: level.value,
      score: score.value,
      time: time.value,
      lives,
      boardWrap,
      board,
      toast,
      status,
      screen,
      screenTitle,
      screenStats,
      continueButton,
    };
  }

  private buildCards(): void {
    const state = this.state;
    const refs = this.refs;
    if (!state || !refs) return;
    const cards = state.cards.map((card, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.cardIndex = String(index);
      button.dataset.testid = `bias-match-card-${index}`;

      const inner = document.createElement("span");
      inner.className = styles.cardInner;
      const back = document.createElement("span");
      back.className = `${styles.face} ${styles.back}`;
      const star = document.createElement("span");
      star.className = styles.star;
      star.textContent = "★";
      back.appendChild(star);

      const front = document.createElement("span");
      front.className = `${styles.face} ${styles.front}${
        card.bonus ? ` ${styles.bonusFace}` : ""
      }`;
      const image = document.createElement("img");
      image.src = `${ASSET_BASE}face_${String(card.face).padStart(2, "0")}.webp`;
      image.alt = "";
      front.appendChild(image);
      if (card.bonus) {
        const badge = document.createElement("span");
        badge.className = styles.bonusStar;
        badge.textContent = "✨2×";
        front.appendChild(badge);
      }
      inner.append(back, front);
      button.appendChild(inner);
      return button;
    });
    refs.board.replaceChildren(...cards);
    this.cardButtons = cards;
    this.applyGeometry();
  }

  private applyGeometry(): void {
    const state = this.state;
    const refs = this.refs;
    if (!state || !refs) return;
    const config = LEVELS[state.level - 1];
    const availableWidth = refs.boardWrap.clientWidth - 8;
    const availableHeight = refs.boardWrap.clientHeight - 8;
    if (availableWidth <= 0 || availableHeight <= 0) return;
    const width = Math.floor(
      Math.min(
        (availableWidth - CARD_GAP * (config.cols - 1)) / config.cols,
        (availableHeight - CARD_GAP * (config.rows - 1)) /
          config.rows /
          CARD_ASPECT,
      ),
    );
    const cardWidth = Math.max(44, width);
    const cardHeight = Math.floor(cardWidth * CARD_ASPECT);
    refs.board.style.gridTemplateColumns = `repeat(${config.cols}, ${cardWidth}px)`;
    refs.board.style.gap = `${CARD_GAP}px`;
    for (const button of this.cardButtons) {
      button.style.width = `${cardWidth}px`;
      button.style.height = `${cardHeight}px`;
    }
  }

  private selectCard(index: number): void {
    const state = this.state;
    if (!state) return;
    const result = selectBiasMatchCard(state, index);
    if (result === "ignored") return;
    this.ctx.audio.play("bias-match-flip");
    if (result === "pair" && state.pending?.kind === "mismatch") {
      this.ctx.audio.play("bias-match-miss");
    }
    this.refreshCards();
  }

  private continueLevel(): void {
    const state = this.state;
    const rng = this.rng;
    if (!state || !rng || this.paused || !continueBiasMatch(state, rng)) {
      return;
    }
    this.clearFeedback();
    this.buildCards();
    this.renderAll();
  }

  private renderAll(): void {
    this.renderHud();
    this.refreshCards();
    this.renderOverlay();
  }

  private renderHud(): void {
    const state = this.state;
    const refs = this.refs;
    if (!state || !refs) return;
    refs.level.textContent = `${state.level}/${LEVELS.length}`;
    refs.score.textContent = String(state.score);
    refs.time.textContent = formattedTime(state.elapsedMs);
    refs.lives.textContent =
      "💖".repeat(Math.max(0, state.lives)) +
      "🖤".repeat(FIXED_LIVES - Math.max(0, state.lives));
    refs.lives.setAttribute(
      "aria-label",
      this.ctx.t("game.bias-match.livesValue", {
        count: Math.max(0, state.lives),
        max: FIXED_LIVES,
      }),
    );
  }

  private refreshCards(): void {
    const state = this.state;
    if (!state) return;
    const total = state.cards.length;
    const wrong = new Set(
      state.pending?.kind === "mismatch" ? state.pending.indices : [],
    );
    state.cards.forEach((card, index) => {
      const button = this.cardButtons[index];
      if (!button) return;
      const revealed = state.peekRemainingMs > 0 || card.status !== "hidden";
      button.className = [
        styles.card,
        revealed ? styles.flipped : "",
        card.status === "matched" ? styles.matched : "",
        wrong.has(index) ? styles.wrong : "",
      ]
        .filter(Boolean)
        .join(" ");
      button.disabled =
        this.paused ||
        state.phase !== "playing" ||
        state.peekRemainingMs > 0 ||
        state.pending !== null ||
        card.status !== "hidden";
      const baseLabel = revealed
        ? this.ctx.t("game.bias-match.card.revealed", {
            index: index + 1,
            total,
            face: card.face + 1,
          })
        : this.ctx.t("game.bias-match.card.hidden", {
            index: index + 1,
            total,
          });
      button.setAttribute(
        "aria-label",
        `${baseLabel}${
          revealed && card.bonus
            ? ` ${this.ctx.t("game.bias-match.card.gold")}`
            : ""
        }`,
      );
    });
  }

  private renderOverlay(): void {
    const state = this.state;
    const refs = this.refs;
    if (!state || !refs) return;
    const t = this.ctx.t;
    if (state.phase === "playing") {
      refs.screen.className = `${styles.screen} ${styles.hidden}`;
      return;
    }

    refs.screen.className = `${styles.screen}${
      state.phase === "lost" || state.phase === "won"
        ? ` ${styles.resultScreen}`
        : ""
    }`;
    if (state.phase === "transition") {
      const nextLevel = state.level + 1;
      refs.screenTitle.textContent = t("game.bias-match.levelTitle", {
        level: nextLevel,
      });
      refs.screenStats.textContent = t("game.bias-match.levelStats", {
        cards: LEVELS[nextLevel - 1].cols * LEVELS[nextLevel - 1].rows,
        pairs: pairCountForLevel(nextLevel),
        lives: FIXED_LIVES,
      });
      refs.continueButton.hidden = false;
      refs.continueButton.disabled = this.paused;
      return;
    }

    refs.screenTitle.textContent =
      state.phase === "won"
        ? t("game.bias-match.winTitle")
        : t("game.bias-match.loseTitle");
    refs.screenStats.textContent = t(
      state.phase === "won"
        ? "game.bias-match.winStats"
        : "game.bias-match.loseStats",
      {
        level: state.level,
        total: LEVELS.length,
        score: state.score,
        time: formattedTime(state.elapsedMs),
      },
    );
    refs.continueButton.hidden = true;
  }

  private showToast(text: string, color: string): void {
    const refs = this.refs;
    if (!refs) return;
    refs.toast.textContent = text;
    refs.toast.style.color = color;
    refs.toast.className = `${styles.toast} ${styles.toastVisible}`;
    refs.status.textContent = text;
    this.toastRemainingMs = 900;
  }

  private hideToast(): void {
    if (!this.refs) return;
    this.refs.toast.className = styles.toast;
    this.toastRemainingMs = 0;
  }

  private clearFeedback(): void {
    this.hideToast();
    if (!this.refs) return;
    this.refs.toast.textContent = "";
    this.refs.toast.style.removeProperty("color");
    this.refs.status.textContent = "";
  }
}

export const biasMatchDefinition: GameDefinition = {
  apiVersion: 1,
  meta: biasMatchMeta,
  create(ctx: GameContext) {
    return new BiasMatchGame(ctx);
  },
};
