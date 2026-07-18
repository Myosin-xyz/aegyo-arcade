# Aegyo Arcade

Mobile-first K-pop mini-game portal for `arcade.aegyoarena.com`. Turns social
traffic into repeat visits via lightweight canvas/DOM games behind a shared
runtime shell, with a thin retention layer (counted runs, streaks, cosmetic
leaderboards).

**Spec**: [docs/TECH_SPEC.md](docs/TECH_SPEC.md) (v0.2.1 — approved for M0/M1).
Decisions land as ADRs in [docs/decisions/](docs/decisions/).

## Develop

```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test           # vitest contract conformance suite
pnpm test:e2e       # Playwright (real-browser claw spike)
pnpm build && node scripts/check-bundle-budget.mjs
```

## Layout

- `src/shell/` — game runtime contract v0 + host, loop, surface, input, audio
- `src/games/<id>/` — framework-free game modules (`claw` migrated from daebak)
- `docs/games/<id>.md` — per-game rules + deterministic test vectors
- `docs/GAME_INTAKE.md` — external contributor delivery checklist
- `tests/unit` (vitest + jsdom) · `tests/e2e` (Playwright)

House rules: humans commit and push; games never import React or install
global handlers; player-facing strings go through `src/i18n`.
