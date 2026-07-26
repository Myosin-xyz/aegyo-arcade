# TECH_SPEC — Aegyo Arena

**Version**: 0.2.1-DRAFT (counter-review fixes; safe product defaults adopted)
**Date**: 2026-07-17
**Author**: Mateo Daza
**Repo**: `Myosin-xyz/aegyo-arcade` (standalone)
**Deploy target**: `arcade.aegyoarena.com`
**Approval state**: **APPROVED FOR M0/M1 IMPLEMENTATION** under the adopted defaults in §3.1. Public release still requires the external gates in §3.1 and §21. The runtime contract remains provisional until its M0 spikes pass.

---

## 1. Executive Summary

Aegyo Arena is a mobile-first K-pop-themed mini-game portal intended to turn short-lived social traffic into repeat visits. It ships the existing claw machine plus Simon's required five games: Snake, Frogger, infinite jumper, Flappy, and Hangman.

The high-level architecture remains locked: standalone Next.js 16 PWA on Vercel, Railway PostgreSQL + Drizzle (ADR 0004; originally Neon), no game engine, and framework-free TypeScript game modules behind a shared runtime shell.

The v0.2 audit rework corrected four defects in v0.1:

1. The runtime contract is a factory contract and is not frozen until it works against the real claw plus a hostile conformance fixture.
2. Product policy is explicit and versioned; v0.2.1 adopts conservative defaults instead of blocking implementation on stakeholder confirmation.
3. Database constraints and transactions—not rate limits—enforce ranked attempts, claw caps, idempotency, streak credits, and inventory.
4. V1 identity is pseudonymous and arcade-host-only. Prize activation, cross-product identity, and any sweepstakes mechanic require separate approval.

v0.2.1 closes the counter-review findings: `GameMeta` again declares its surface, M0 owns the minimum claw lifecycle refactor needed by its spike, committed analytics use an outbox, practice runs are explicitly non-persistent, the markets teaser is restored to V1.1, contributor versus Myosin intake work is separated, and recovered game-design knowledge is seeded in `docs/games/`.

### 1.1 Funnel

```text
Paid + organic social
        │
        ▼
aegyoarena.com content
        │ campaign parameter only; no shared user identifier in V1
        ▼
arcade.aegyoarena.com  ◄── THIS REPO
        │ games, counted runs, streaks, cosmetic leaderboards
        ▼
Daebak Markets homepage embed  ◄── SEPARATE PROJECT
```

### 1.2 Working success measures

These are working 60-day targets. They may be recalibrated after the first organic cohort without changing event definitions (§17).

| Metric                       | Baseline | Working 60-day target        | Status                      |
| ---------------------------- | -------- | ---------------------------- | --------------------------- |
| Arcade session duration      | None     | ≥ 3 min median               | Working target              |
| D1 return rate               | None     | ≥ 20%                        | Working target              |
| D7 return rate               | None     | ≥ 8%                         | Working target              |
| Games opened per session     | None     | ≥ 2                          | Working target              |
| Counted-run completion rate  | None     | Establish baseline           | Approved to measure         |
| Three-day streak rate        | None     | ≥ 10% of eligible devices    | Working target              |
| Install action rate          | None     | Establish baseline           | Approved to measure         |
| Markets teaser click-through | None     | Establish baseline when live | Separate project dependency |

The main site's 2–3-second session baseline is contextual, not a comparable arcade baseline. Paid and organic cohorts must be reported separately.

---

## 2. Audience and Hard Constraints

| Input                                 | Engineering consequence                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 95% mobile; iOS/Android roughly even  | Touch-first responsive UI; keyboard is an enhancement; no hover-only behavior                    |
| Mid-range Android is the floor device | Transfer, decoded-memory, frame-time, and time-to-play budgets; test on real hardware            |
| LatAm-heavy traffic                   | Locale architecture from day one; `es-419` + `en` launch, `pt-BR` first follow-up                |
| K-pop content and giveaway intent     | Original/license-verified assets; contribution rights and promotion rules are launch gates       |
| Solo staff-level developer            | One app, no game engine, no speculative infrastructure, scripted ops before a full admin product |
| Human-only git commits                | Codex may edit working files and run checks; a human reviews, commits, and pushes                |

`M0 EVIDENCE GATE — BROWSER FLOOR`: reconcile Next.js 16's supported Safari floor with the audience's actual iOS distribution before public launch. Unsupported browsers receive a clear fallback rather than an assumed working experience.

---

## 3. Product Decisions and Scope

### 3.1 Adopted defaults and external gates

The following are the working product decisions as of 2026-07-17. They unblock implementation and should not be escalated to Simon merely for confirmation. A later stakeholder decision may override one through an ADR/spec revision; until then, code, copy, analytics, and tests implement the adopted policy.

| ID   | Decision                                       | Adopted policy                                                                                                                                                                                                                                                                                                                         | Override impact                                                                                 |
| ---- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| OD-1 | Daily play semantics                           | One **completed counted run per device per player-local calendar day, portal-wide**; unlimited practice; abandoned/expired attempts do not burn the entitlement. The server uses the device's validated IANA timezone and stores the resulting eligibility boundary; a timezone change cannot move an already-issued boundary earlier. | Cap scope, messaging, slot policy version, and streak tests change together.                    |
| OD-2 | Meaning of "five games up" and markets handoff | Six-game catalog plus the thin retention loop qualifies for controlled organic soft launch. Finish that loop before the markets handoff; paid traffic waits for M5.                                                                                                                                                                    | Milestone/handoff order and release messaging.                                                  |
| OD-3 | Leaderboard prizes                             | Cosmetic/bragging-rights boards only in V1.                                                                                                                                                                                                                                                                                            | Material prizes require verified identity, replay/re-verification, and rules before activation. |
| OD-4 | Claw prize posture                             | V1 claw is explicitly gameplay-only with no material prize, claim, or giveaway entry. Practice is unlimited; a counted claw run uses the same portal-wide OD-1 entitlement. Keep the server outcome seam and prize-mode kill switch, but do not configure a material-prize promotion.                                                  | Material-prize mode invokes the full §13.3 gate, odds, cap, inventory, and fulfillment work.    |
| OD-5 | Streak giveaway entries                        | No. Streak is visual status/bragging rights only.                                                                                                                                                                                                                                                                                      | Requires a separate promotion spec and counsel-approved rules.                                  |
| OD-6 | Sponsor/geographies/counsel                    | No prize promotion in V1. Counsel still owns audience classification, privacy/consent posture, and any future promotion.                                                                                                                                                                                                               | Public release waits for `EXT-LEGAL`; prize activation remains disabled.                        |
| OD-7 | Campaign attribution                           | Yes: allowlisted UTM-style campaign parameters only, with no shared person identifier.                                                                                                                                                                                                                                                 | Removing it loses paid-cohort measurement; expanding it requires privacy review.                |
| OD-8 | Access and Frogger fallback                    | **Frogger delivery cutoff: end of day Friday 2026-07-31 (AoE).** Internal Frogger fallback is authorized if a conforming delivery is not accepted by that date. The cutoff ships inside the intake package so the contributor sees it.                                                                                                 | DNS/Vercel/Railway access remains an operations dependency, not a product decision.             |

Supporting defaults are also adopted:

- `META-1`: one portal-wide streak.
- `META-2`: cosmetic weekly seasons reset Monday 00:00 UTC; top 50 plus the current device's rank.
- `META-3`: curated generated handles and emoji avatars; no free-text identity.
- `LOCALE-1`: `es-419` + `en` at launch; `pt-BR` is the first localization follow-up.
- `INSTALL-1`: install help is user-invoked from portal navigation in V1; no automatic prompt.

External gates cannot be responsibly guessed and are not Simon memo items:

| Gate          | Required evidence                                                                                                                                                          | Blocks                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `EXT-LEGAL`   | Counsel confirms audience classification, privacy/consent posture, notice text, and retention changes                                                                      | Public release; every material-prize mode |
| `EXT-OPS`     | Myosin-owned DNS, Vercel, Railway (ADR 0004), production credentials, and incident owner are available                                                                     | Production deployment                     |
| `EXT-RIGHTS`  | Asset/content register complete; written rights confirmations only for genuinely EXTERNAL contributors (Nicole and Daidai deliver internal Myosin work product — ADR 0006) | Shipping contributed content              |
| `EXT-LOCALE`  | Native/fan-fluent review for each enabled locale                                                                                                                           | Enabling that locale publicly             |
| `EXT-FROGGER` | Conforming Daidai delivery by end of M1, or internal fallback begins                                                                                                       | Five-game gate only                       |

### 3.2 Locked launch catalog

Launch catalog means **playable catalog**, not automatic authorization to run promotions.

| #   | Game            | Working title   | Source                         | Path                                                                                |
| --- | --------------- | --------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| 0   | Claw machine    | Aegyo Claw      | Existing Vite/vanilla-TS app   | Migrate and adapt (§7.1)                                                            |
| 1   | Snake           | Snake Freebies  | Daidai delivery (2026-07-26)   | Ported to shell (replaced the POCA Snake placeholder; docs/games/snake-freebies.md) |
| 2   | Flappy          | Bias Flap       | Nicole mock                    | Rebuild against shell                                                               |
| 3   | Infinite jumper | Comeback Climb  | Nicole mock                    | Rebuild against shell                                                               |
| 4   | Hangman         | Guess the Slang | Nicole mock                    | DOM module                                                                          |
| 5   | Frogger         | Name pending    | Daidai, with internal fallback | Intake or rebuild                                                                   |

Claw + Simon's five = six playable games. Photo Chase and Spot the Bias remain fast-follow candidates, not launch dependencies.

### 3.3 Adopted V1 baseline

- Six playable games, subject to Frogger delivery/fallback.
- Unlimited practice plus one portal-wide counted completion per player-local day under OD-1.
- Cosmetic weekly leaderboards only.
- Visual portal-wide streak only; no giveaway entries.
- Claw runs in clearly labeled gameplay-only mode. Material-prize mode stays kill-switched and unconfigured.
- PWA manifest/installability only; no offline game cache or background submission queue.
- Pseudonymous arcade-host-only identity; no account, email, phone, birth date, wallet, or cross-product cookie.
- Explicit analytics events through a provider-neutral sink, initialized only after the approved privacy/consent condition.
- V1.1 includes a static Markets teaser tile; it remains a plain link surface with no Daebak code or cross-product identity.

### 3.4 Explicit non-goals

1. Prediction-market, wallet, chain, wager, or DBK bridge code.
2. User-generated content, chat, comments, custom handles, or direct messages.
3. Native app-store builds.
4. Offline ranked play or background score synchronization.
5. Full shipping, warehouse, or customer-support system.
6. Material leaderboard prizes without an approved verification design.
7. Giveaway entries without a promotion specification and official rules.
8. Cross-product identity or parent-domain cookies.
9. All-time leaderboards in V1.

---

## 4. Architecture Decisions

| Area              | Decision                                | Notes                                                                                                                                                                             |
| ----------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository        | Standalone single app                   | No monorepo/workspace overhead                                                                                                                                                    |
| Framework         | Next.js 16 App Router on Vercel         | Locked upstream; home remains mostly Server Components                                                                                                                            |
| Game technology   | Vanilla Canvas 2D or DOM + TypeScript   | No Phaser/Pixi; new canvas games use shell loop                                                                                                                                   |
| Runtime boundary  | Versioned factory contract (§6)         | Frozen only after conformance spikes                                                                                                                                              |
| Styling           | Tailwind CSS 4 for portal chrome        | Games use canvas or scoped CSS                                                                                                                                                    |
| Database          | Railway PostgreSQL + Drizzle (ADR 0004) | Correctness constraints live in Postgres; no managed PgBouncer on the provisioned template — app + migrations use the external URL with `attachDatabasePool` (ADR 0004 amendment) |
| Identity          | Host-only pseudonymous session          | `__Host-aegyo_device`; no `Domain`, no localStorage mirror                                                                                                                        |
| i18n              | Small typed `t()` layer over JSON       | Locale order remains `LOCALE-1`                                                                                                                                                   |
| Analytics         | Provider-neutral `AnalyticsSink`        | PostHog is a candidate, not an unconditional dependency                                                                                                                           |
| PWA               | Manifest/installability only in V1      | Service worker/offline features deferred                                                                                                                                          |
| Package/runtime   | pnpm, Node 22 LTS                       | Team standard                                                                                                                                                                     |
| Hosting ownership | Myosin Vercel/Railway organizations     | No personal-account production infrastructure                                                                                                                                     |

The arcade does not import Daebak code. Campaign attribution uses allowlisted link parameters, not a shared identity cookie.

---

## 5. Repository Structure

```text
aegyo-arcade/
├── docs/
│   ├── TECH_SPEC.md
│   ├── GAME_INTAKE.md               # sent before contributor delivery
│   ├── OPS_RUNBOOK.md                # claims, flags, voids, deletion, incidents
│   ├── CONTRIBUTOR_RIGHTS.md         # short rights-confirmation template
│   ├── decisions/                    # OD answers / ADRs
│   └── games/<gameId>.md             # one-page rules + ranked test vectors
├── public/
│   ├── icons/
│   └── games/<gameId>/               # versioned runtime assets
├── scripts/
│   ├── export-claw-layers.py
│   └── ops/                           # audited human-run operations
├── src/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── play/[gameId]/page.tsx
│   │   ├── leaderboard/[gameId]/page.tsx
│   │   └── api/
│   ├── shell/
│   │   ├── host.tsx
│   │   ├── contract.ts
│   │   ├── loop.ts
│   │   ├── surface.ts
│   │   ├── input.ts
│   │   ├── audio.ts
│   │   └── conformance.ts
│   ├── games/
│   │   ├── registry.ts
│   │   ├── claw/
│   │   ├── snake/
│   │   ├── flappy/
│   │   ├── jumper/
│   │   ├── hangman/
│   │   └── frogger/
│   ├── meta/
│   ├── i18n/
│   ├── db/
│   └── lib/
└── tests/
```

Rules:

- `src/games/**` never imports React, Next, or `src/app/**`.
- Portal metadata is available without loading a game's implementation chunk.
- `GameDefinition.create()` returns a fresh instance; modules do not hold singleton run state.
- Public assets use a build/content version in their URL or manifest. A service worker must never be required to invalidate V1 assets.

---

## 6. Game Runtime Contract v1 (FROZEN — ADR 0005)

### 6.1 Freeze rule

**FROZEN as v1 on 2026-07-18 (ADR 0005).** Every condition below ran green:
the real claw through its adapter (module-loop), the hostile fixture, host
conformance, plus both production compatibility checks per ADR 0001's
substitution — Flappy (`canvas`, shell loop) and Hangman (`dom`). Changes
now require an ADR and a major `apiVersion` decision. The original freeze
conditions, kept for the record:

1. The real claw mounts, starts, pauses, resumes, restarts in place, and destroys through an adapter. M0 explicitly includes the minimum engine refactor needed to make its private rAF lifecycle cancellable/resumable; this is not treated as adapter-only work. **Scope note (M0 review reconciliation):** the M0 browser spike covers mount/start/pause/resume/destroy; restart-in-place for the module-loop claw is validated at adapter level by M1's repeatable `start()` (`resetToReady()` + `run()`), and the host-level `ended → running` transition is exercised by the host conformance suite with the shell-loop fixture. Contract v1 may not freeze before ALL of these have run green together.
2. A hostile fixture exercises slow init, init abort, duplicate `start`, asset failure, global-listener attempts, pause/resume, end-at-most-once, and destroy-before-init-completes.
3. Conformance tests show zero remaining timers, animation frames, input subscriptions, audio nodes, or mounted DOM after destroy.
4. `InputBus` and `AudioBus` v1 shapes, event semantics, ownership, and teardown behavior are written and exercised by both fixtures.

~~Frogger is the second external compatibility check. If it forces a material contract change, the contract remains v0 until that intake completes.~~ **SUPERSEDED (ADR 0001 amendment + ADR 0005):** the substitution checks — Flappy (`canvas`, shell loop) and Hangman (`dom`) — served as the production compatibility evidence; v1 froze on them. The delivered Frogger targets the FROZEN contract at M3.

### 6.2 Contract

```ts
export type RunMode = "practice" | "counted" | "prize";

export interface GameMeta {
  id: string;
  surface: "canvas" | "dom";
  titleKey: string;
  taglineKey: string;
  designBox: { w: number; h: number };
  capabilities: {
    counted: boolean;
    prize: boolean;
  };
}

export type GameSurface =
  | {
      kind: "canvas";
      canvas: HTMLCanvasElement;
      context2d: CanvasRenderingContext2D;
      designBox: { w: number; h: number };
    }
  | {
      kind: "dom";
      root: HTMLElement;
    };

interface RunContextBase {
  seed: string;
  random: () => number; // seeded PRNG; no Math.random() in ranked mechanics
  signal: AbortSignal;
}

// Discriminated on mode: a counted/prize run WITHOUT an attempt id is
// unrepresentable, and games must reject malformed contexts at runtime
// (fail closed — never behave like practice).
export type RunContext =
  | (RunContextBase & { mode: "practice"; attemptId: null })
  | (RunContextBase & { mode: "counted" | "prize"; attemptId: string });

export interface GameContext {
  host: HTMLElement;
  surface: GameSurface;
  input: InputBus; // every subscription returns an unsubscribe function
  audio: AudioBus;
  t: (key: string, vars?: Record<string, string | number>) => string;
  report: {
    score: (score: number) => void;
    end: (result?: { reason?: "completed" | "lost" | "quit" }) => void;
  };
}

interface BaseGameInstance {
  init(signal: AbortSignal): Promise<void> | void;
  start(run: RunContext): void; // fresh state; callable again after a run ends
  pause(reason: "hidden" | "blur" | "system"): void;
  resume(): void;
  destroy(): void; // idempotent, including during failed/aborted init
}

export interface ShellLoopGame extends BaseGameInstance {
  loop: "shell";
  update(dtMs: number): void;
  render(alpha: number): void;
}

export interface ModuleLoopGame extends BaseGameInstance {
  loop: "module";
}

export type GameInstance = ShellLoopGame | ModuleLoopGame;

export interface GameDefinition {
  apiVersion: 1;
  meta: GameMeta;
  create(ctx: GameContext): GameInstance;
}
```

The registry exposes `GameMeta` from a metadata-only module before loading the implementation chunk. The host reads `meta.surface`, constructs the matching `GameSurface`, then lazy-loads `GameDefinition`; conformance asserts that the definition metadata matches the registry entry.

`InputBus` and `AudioBus` are M0 contract deliverables rather than unspecified `any`-shaped services. At minimum, M0 defines normalized pointer coordinates/actions, unsubscribe-returning input subscriptions, enable/disable semantics, audio gesture-unlock state, mute state, SFX playback/registration, and idempotent teardown. No game may reach around either bus to install global input or create an unmanaged `AudioContext`.

**Claw-only V1 legacy exception (ADR 0005):** the migrated claw engine predates the buses and keeps its own canvas/window listeners and module-level WebAudio, behind the `loop: "module"` escape hatch. The exception is NARROW and closed: it applies to `games/claw` only; the legacy adapter MUST expose `setEnabled`, be disabled on pause and re-enabled on resume (pause determinism is portal-wide), tear down every listener/timer on destroy, honor bus mute via `onMutedChange`, and pass leak conformance. NO new game receives this exception — new games use the buses, full stop. The exception retires if/when the claw engine is ever rebuilt.

### 6.3 Ownership and invariants

| Concern            | Owner / invariant                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clock and duration | Shell records monotonic start, pause, resume, and end. Games never submit duration as authority.                                                        |
| Score              | Game reports live integer score; shell validates finite/non-negative shape and captures the final value. Server still treats client score as untrusted. |
| End                | `report.end()` is accepted once. Duplicate calls are ignored and logged in development.                                                                 |
| Randomness         | Counted/prize run receives a seeded PRNG through `RunContext`; games do not use `Math.random()` for ranked mechanics.                                   |
| Canvas sizing      | Shell owns CSS/backing size, logical transform, resize, and an effective DPR cap (default 2).                                                           |
| Input              | Surface-scoped pointer input; keyboard optional; teardown is mandatory.                                                                                 |
| Audio              | Gesture unlock and global mute are shell services. Module-loop exception may adapt legacy audio but must honor mute/destroy.                            |
| Lifecycle          | Shell pauses on visibility change. Eligibility rules define whether paused wall time counts; games do not decide.                                       |
| Restart            | Shell obtains a new `RunContext` and calls `start()` on the existing initialized instance.                                                              |
| Errors             | Host renders localized load/retry/back UX. A failed game never traps the portal route.                                                                  |

Lifecycle state is explicit: `created → initializing → ready → running ↔ paused → ended`, and a new run may transition `ended → running` with a fresh `RunContext`. `init()` runs once. `start()` is valid only from `ready` or `ended`; a call while already running/paused is rejected without creating another loop or subscription. `destroy()` is terminal and valid from every state, including failed/aborted initialization.

New games use `loop: "shell"`. `loop: "module"` is a documented migration escape hatch for the claw, not the default adapter strategy.

### 6.4 Counted-run semantics

The shell asks the server for the portal-wide counted slot before `start()`. Practice starts locally. The server derives `dayKey` and the next eligibility boundary from the persisted, validated IANA timezone under OD-1; the client never declares itself eligible.

An attempt is not a successful counted run until its result transaction commits. Abandoned/expired attempts are replaceable and do not consume the entitlement; the slot state machine in §9 enforces that rule.

---

## 7. Games and Intake

### 7.1 Aegyo Claw migration

The claw is portable but not contract-compatible unchanged. Its current engine owns rAF, canvas sizing, input, WebAudio, and restart. Migration therefore includes a small explicit refactor rather than an adapter-only claim.

#### Required work

1. Copy source and runtime assets out of `daebak-markets/apps/aegyo-claw`; preserve history/provenance in the migration PR notes.
2. **M0 spike slice:** make the private rAF lifecycle cancellable/resumable and expose enough `pause()`/`resume()` behavior for the real conformance spike. **M1 completion:** add repeatable `start()` and idempotent `destroy()`, then inject `host`, canvas, outcome provider, and production-safe feature flags. M0 estimation owns the spike slice; it is not deferred or disguised as adapter code.
3. Remove the production dev panel from the bundle; development force-outcome controls must have teardown and must never influence the production API.
4. Update the PSD exporter and manifest/loader together for WebP or another chosen format. Pin Python dependencies and store the PSD, checksum, and rights record in Myosin-owned shared storage.
5. Reduce decoded memory, not only transfer size. The manifest measurement is about 44 MiB before canvas/runtime allocations: three full-frame 1344×2126 layers account for roughly 11 MiB RGBA each. Target ≤ 32 MiB using the exporter's existing `SCALE` control plus content-box cropping for `frontPlush`/`frame`, then verify on the floor Android; a higher measured limit requires a documented device result.
6. Implement the idempotent server outcome seam for counted gameplay (§9.4, §10). V1 returns gameplay outcomes only and creates no claim/inventory state; material-prize mode stays unconfigured behind the §13.3 gate.
7. Parity QA, then cut over in this order: deploy new URL → update/redirect existing links → observe → remove old static copy and Vite app in a separate human-committed PR.

#### Acceptance

- Visual/feel parity on the device matrix.
- Pause/resume/restart/destroy conformance passes.
- Lost response retries return the original play outcome and never consume a second play.
- No production force-outcome path.
- Asset transfer and decoded-memory budgets pass.
- Old Daebak source/runtime copy is removed after successful cutover; links/redirects are allowed, source coupling is not.

### 7.2 Nicole-derived games

The design, tone, and rules are source material; implementation is rebuilt against the shell. The recovered v0.1 keep/change findings now seed `docs/games/snake.md`, `flappy.md`, `jumper.md`, and `hangman.md`; they are inputs to implementation rather than discarded audit history. Every game document contains:

- Objective and exact scoring formula.
- Run start/end conditions and maximum duration.
- Input behavior and minimum touch targets.
- Difficulty curve and RNG use.
- Pause/visibility treatment.
- Collision/rule edge cases.
- Counted-run seed vectors and deterministic expected scores/states.
- Plausibility envelope, if cosmetic score validation is retained.
- Accessibility and reduced-motion behavior.

The seed documents distinguish preserved feel from structural fixes and optional tuning. In particular: Snake begins at the harvested 140ms step; Flappy preserves `g≈0.45`, flap impulse `≈−7.5`, and gap `≈180` logical px; Jumper preserves the chart-position framing; Hangman preserves the six-life fan-lexicon loop. Fan terms remain English across locales while instructions and hints are translated. Speed ramp, tilt control, daily-word cadence, and vocabulary edits are testable content/tuning changes, not accidental consequences of the rewrite.

If Hangman ever awards leaderboard prizes, the answer cannot be a client-enumerable daily content file. It needs a server challenge plus a verification design or must remain non-prize.

### 7.3 Frogger intake

`docs/GAME_INTAKE.md` is ready to send before Daidai gets deeper into Frogger. Contributor deliverables are:

1. Source folder and build/run instructions; no opaque minified-only delivery.
2. UTF-8; no external CDNs/fonts/scripts.
3. Responsive portrait reference box; no device-pixel assumptions.
4. Pointer/touch first; no hover dependency.
5. All player-facing strings centralized.
6. Asset provenance and written Myosin usage rights.
7. Exact scoring and end condition.
8. No uncontrolled global handlers/timers after destroy.
9. Raw asset files/dimensions and any known target-device or performance constraints; no requirement for Daidai to produce our performance measurements.

After receipt, **Myosin** runs transfer-size, decoded-memory, device-floor, lifecycle/leak, accessibility, and production-build checks. An adapter may translate a reasonable lifecycle; it is not expected to absorb arbitrary global code. Source is modified when needed. If no conforming delivery is accepted by the end of M1, a simple internal Frogger is built against the shell.

### 7.4 Contributor rights

Two paths (ADR 0006). **Internal work product** — contributors working with Myosin (currently Nicole and Daidai) deliver Myosin work product; no separate written confirmation is required, but every intake still records provenance in the asset/content register and identifies any embedded third-party material. **Genuinely external contributors** — the short confirmation in `docs/CONTRIBUTOR_RIGHTS.md` (use, modify, distribute, commercially operate; excluded third-party material identified) is required and intake does not complete without it; an ownership assignment, if needed, is counsel work rather than something this engineering spec invents.

---

## 8. Identity, Streaks, and Leaderboards

### 8.1 Pseudonymous device session

- `POST /api/session` issues a 256-bit opaque token in `__Host-aegyo_device`.
- Cookie attributes: `Secure; HttpOnly; SameSite=Lax; Path=/`; no `Domain` attribute.
- Only a SHA-256 token hash is stored. It maps to an internal device UUID.
- No localStorage mirror and no device ID returned to client JavaScript.
- Session bootstrap may submit the browser's IANA timezone. The server validates/persists it and applies the OD-1 boundary rule; an unsupported value falls back to UTC with visible next-eligibility time.
- Engineering default rolling token/device retention: 90 days since last activity, subject to `EXT-LEGAL` counsel correction.
- `DELETE /api/privacy/device` deletes or legally tombstones device-linked non-promotion data and invalidates the token.
- No email, phone, name, birth date, social handle, wallet, or free-text handle in V1.

This is pseudonymous tracking, not anonymity. Cross-device continuity and one-human enforcement are not claimed.

### 8.2 Streaks

Adopted behavior (`META-1`): one portal-wide streak advances after a successful counted completion for the player-day defined by OD-1. Missing a player-day resets current streak. Practice does not advance it.

V1 reward is visual status only. `giveaway_entries` does not exist. Adding it requires an explicit OD-5 override plus a separate promotion spec defining the entry period, eligibility, deduplication, drawing, rules, and fulfillment.

### 8.3 Cosmetic leaderboards

Adopted V1 (`OD-3`): weekly cosmetic boards only, resetting Monday 00:00 UTC. Display top 50 plus the current device's rank (`META-2`). Scores remain client-submitted and visibly labeled as provisional/fair-play boards; no physical or monetary value is attached.

**Adopted ranking policy (M2):** competition ranking — rank = 1 + count of strictly greater scores, so ties share a rank ("1, 1, 3") — implemented by ONE shared query/policy for every surface. Rows with `flagged = true` are invisible EVERYWHERE: excluded from top lists, from a device's own best/rank, and from rank counting at submission time. Moderation can never inflate or deflate a legitimate rank inconsistently.

If OD-3 is later overridden to add material prizes, this section is replaced before that feature is built with:

- Prize-eligible identity/account rules.
- Deterministic input trace format and replay verifier, or an approved re-verification ceremony.
- Objective disqualification, tie, appeal, and fallback-winner rules.
- Per-game verification coverage, including Frogger and Hangman.

Plausibility bounds and human review alone never authorize a prize.

### 8.4 Display identity

Generated handles/emoji (`META-3`) are adopted. Lists are curated, collision-suffixed, non-editable, and removable by deleting the device record. No custom/free-text handles ship in V1.

---

## 9. Database Model and Correctness Invariants

### 9.1 Core records

```text
devices
  id, locale, time_zone, time_zone_changed_at, generated_handle?,
  avatar_emoji?, created_at, last_seen_at, privacy_state

device_sessions
  token_hash PK, device_id, created_at, expires_at, revoked_at?

daily_slots
  id, device_id, day_key, scope_key, policy_version, time_zone,
  eligible_after_at, completed_run_id?, created_at
  UNIQUE(device_id, day_key, scope_key)

run_attempts
  id, slot_id?, device_id, game_id, mode, attempt_no, seed,
  status(issued|submitted|expired|void), score?, client_duration_ms?,
  server_elapsed_ms?, issued_at, expires_at, submitted_at?,
  result_snapshot? (jsonb acceptance receipt {score, seasonKey, rank,
  streak} — replays return THIS verbatim; a submitted attempt without a
  valid receipt fails closed on the generic endpoint),
  idempotency_key
  UNIQUE(device_id, idempotency_key)
  UNIQUE INDEX one_issued_attempt_per_slot ON (slot_id) WHERE status = 'issued'
  UNIQUE INDEX one_submitted_attempt_per_slot ON (slot_id) WHERE status = 'submitted'

streaks
  device_id PK, current, best, last_day_key, updated_at

leaderboard_scores
  run_id PK, device_id, game_id, season_key, score, accepted_at, flagged

promotions
  id, channel(claw), kind(demo|material_prize),
  status(draft|active|paused|ended), rules_version,
  eligibility_version, odds_version?, starts_at, ends_at
  UNIQUE INDEX one_active_config_per_channel ON (channel) WHERE status = 'active'

prize_inventory
  promotion_id, sku, total, reserved, fulfilled
  PRIMARY KEY(promotion_id, sku)
  CHECK(total >= 0 AND reserved >= 0 AND fulfilled >= 0)
  CHECK(reserved + fulfilled <= total)

claw_plays
  id, promotion_id, attempt_id? UNIQUE, device_id, day_key, ordinal, outcome,
  idempotency_key, created_at
  UNIQUE(promotion_id, device_id, day_key, ordinal)
  UNIQUE(promotion_id, device_id, idempotency_key)

prize_claims
  id, play_id UNIQUE, token_hash UNIQUE, status,
  expires_at, claimed_at?, fulfilled_at?, void_reason?

ops_audit
  id, actor, action, target_type, target_id, reason, before_json,
  after_json, created_at

analytics_outbox
  id, event_name, aggregate_type, aggregate_id, payload_json,
  created_at, published_at?, attempt_count
  UNIQUE(event_name, aggregate_type, aggregate_id)
```

`giveaway_entries` is deliberately absent from baseline V1.

Only counted attempts create `run_attempts` rows. Practice runs remain in memory and produce only allowed aggregate/behavioral analytics; §9.5's practice-retention row refers to those analytics, not practice-run records.

### 9.2 Counted-attempt transaction

V1 uses `scope_key = portal`; the `game:<id>` shape remains supported for an explicit future policy override. Issuance:

1. Resolve the device's validated IANA timezone. A requested timezone change is recorded but cannot move an existing `eligible_after_at` earlier.
2. Derive `day_key` and the next local-calendar boundary server-side, then begin a transaction and lock/create `(device, day_key, scope_key)`.
3. If `completed_run_id` exists or the most recent completed slot's `eligible_after_at` is still in the future, return `409 DAILY_SLOT_USED` with the server eligibility time.
4. If an unexpired issued attempt exists, return it idempotently.
5. Expire an abandoned attempt and insert one replacement only after its expiry/replacement condition is met.
6. Insert one issued attempt with a server seed and expiry; commit.

Submission:

1. Lock attempt and slot.
2. If already submitted, return the original result.
3. Reject expired/void attempts and game/subject mismatches.
4. Validate shape and applicable verification policy.
5. Mark submitted, set slot completion, write the cosmetic leaderboard score, update the streak, persist the immutable `result_snapshot` acceptance receipt, and insert the server analytics **outbox row** in one transaction. Replays return the receipt, never recomputed values.
6. Return the committed result.

An asynchronous publisher drains `analytics_outbox` only after commit and marks delivery/retry state. No external analytics HTTP call occurs inside the gameplay transaction. Rate limits reduce abuse; they do not replace database constraints.

### 9.3 Streak transaction

The streak updates only inside a successful counted-submission transaction. A counted claw run follows the same path; a practice claw play never advances the streak. Repeating an idempotency key cannot advance a streak twice. Day-key calculation is a single server function with local-midnight, DST, and timezone-change boundary test vectors.

### 9.4 Claw play and inventory transaction

Practice claw outcomes are local gameplay and create no `claw_plays` row. The counted path uses an active `demo` configuration and a valid counted `attempt_id`; its UI says that no material prize is offered, and it cannot create inventory reservations or claim tokens. An active `material_prize` configuration is disabled until the §13.3 gate passes.

1. Require an active claw configuration, a device-scoped idempotency key, and—in demo mode—the device's valid counted attempt.
2. Lock the device/configuration/day counter and counted attempt; for material-prize mode, also lock the applicable inventory row.
3. If the same idempotency key exists, return its original outcome.
4. In demo mode, enforce one recorded outcome per `attempt_id`; OD-1 enforces the portal-wide entitlement. A future material-prize configuration enforces its separately approved cap with a stored ordinal.
5. Draw using the immutable active odds version. In demo mode, the result is gameplay-only. In material-prize mode, a winning result is possible only if inventory can be reserved atomically.
6. Insert the play. Only for a material-prize win, reserve inventory and create a claim-token hash in the same transaction.
7. Commit before returning the outcome/claim URL.

Promotion odds cannot be silently edited. A change creates a new audited version with an effective time and must remain consistent with approved rules.

### 9.5 Provisional retention

| Data                              | Default retention                         | Notes                                               |
| --------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| Device session/profile            | 90 days since activity                    | `EXT-LEGAL` may shorten/alter                       |
| Practice analytics                | 90 days, aggregated sooner where possible | No exhaustive practice-run DB rows                  |
| Run attempts / cosmetic scores    | 90 days                                   | Covers 60-day experiment and dispute window         |
| Ephemeral abuse IP hash           | 24 hours                                  | Rotating salt; no raw IP in application tables      |
| Client UA class / viewport bucket | 30 days                                   | Coarse values only                                  |
| Prize/promotion/ops records       | `OPEN LEGAL DECISION`                     | Rules, tax, dispute, and audit requirements control |

Deletion jobs run daily and are tested. Platform/provider logs are inventoried separately rather than implied away.

---

## 10. API Surface and Error Semantics

| Endpoint                    | Method   | Purpose                                                                                                                             |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/api/session`              | POST     | Issue/refresh host-only session; accept validated IANA timezone; return locale, streak, next eligibility, and display identity only |
| `/api/privacy/device`       | DELETE   | Delete/tombstone device data and revoke session                                                                                     |
| `/api/runs`                 | POST     | Issue/recover counted attempt based on server policy                                                                                |
| `/api/runs/:id`             | PUT      | Idempotently submit score/result; server captures receipt time                                                                      |
| `/api/streak`               | GET      | Current visual streak                                                                                                               |
| `/api/leaderboards/:gameId` | GET      | Current cosmetic season + own rank                                                                                                  |
| `/api/claw/plays`           | POST     | Idempotent capped outcome; requires active demo or material-prize config                                                            |
| `/api/prize-claims/:token`  | GET/POST | Show/advance approved claim flow without exposing raw DB IDs                                                                        |

Mutating endpoints require JSON content type, strict request schemas, same-origin validation, and an idempotency key where retries are plausible. CORS does not permit arbitrary origins.

### 10.1 User-visible failure states

| Failure                       | Required behavior                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| Game asset/init failure       | Localized retry and Back; no blank canvas                                                              |
| Counted slot already used     | Explain next eligibility; offer practice                                                               |
| Counted issue unavailable     | Practice remains available; no fake counted state                                                      |
| Score submit fails            | Keep result in memory and allow same-page idempotent retry; mark as not submitted; no background queue |
| Claw request/response loss    | Retry the same idempotency key and return original outcome                                             |
| Promotion paused/out of stock | Disable prize play before animation; never announce an unreserved win                                  |
| Database unavailable          | Practice only; prize/counted actions fail closed                                                       |
| Analytics blocked/unavailable | Gameplay unaffected                                                                                    |
| Unsupported browser           | Clear compatibility message and portal navigation fallback                                             |

---

## 11. PWA and Installability

V1 includes:

- App Router manifest with name, colors, start URL, standalone display, and owned maskable icons.
- HTTPS and responsive standalone layout.
- User-invoked install guidance from portal navigation under `INSTALL-1`; no automatic prompt.
- No promise that portrait orientation is enforceable on every browser.

V1 excludes:

- Service worker caching strategy.
- Offline portal/game guarantees.
- IndexedDB score queues or Background Sync.
- Push notifications.
- Serwist/Workbox dependency.

A service worker is reconsidered only after install/return data shows value and a separate cache-invalidation/error design is approved.

---

## 12. Internationalization, Content, and Rights

### 12.1 Locale mechanics

- Typed `t(key, vars)` and per-locale JSON.
- Initial locale from `Accept-Language`; client preference can update the device record.
- No claim that geography determines language. A Spanish-configured US device may receive Spanish.
- Missing keys fail CI; a simple static check is preferred over a bespoke parser-heavy ESLint plugin.
- Player-facing strings are not hard-coded in game logic.

Launch language order follows adopted `LOCALE-1`. Native/fan-fluent review is a launch criterion for every enabled locale.

K-pop fan lexicon—such as bias, maknae, comeback, aegyo, fanchant, and lightstick—stays in its community-standard English form in every locale. Surrounding instructions, hints, accessibility text, and explanations are translated.

### 12.2 Content and IP controls

The rule is evidence, not a blanket slogan:

1. Every asset/content item has author, source, rights basis, permitted use, and reviewer in a register.
2. Rights basis is recorded per §7.4 — internal Myosin work product (ADR 0006) or a written external-contributor confirmation.
3. No artist photo, logo, album art, lyric, or third-party merch image ships without written rights evidence.
4. Generic fandom vocabulary is reviewed for trademark/content risk and brand fit.
5. Nominative artist/group references, if desired, require counsel-approved guidance rather than a developer-invented absolute ban.
6. Prize descriptions and images match owned inventory and approved rules.

Nicole's mojibake source is restored deliberately into UTF-8 dictionaries; corrupted copy is never pasted blindly.

---

## 13. Compliance, Privacy, and Promotion Gates

### 13.1 Current-law posture

This section is engineering risk framing, not legal advice; `EXT-LEGAL` counsel owns the final classification and requirements.

The applicable US framework is COPPA and its amended FTC Rule, not a generic claim that "COPA passed in February 2026." The February 2026 FTC statement addressed an enforcement approach for qualifying age-verification data; it did not make age verification universally mandatory. Pending federal legislation is tracked but not represented as enacted law.

The arcade's child-directed/mixed/general-audience classification is a public-release gate under `EXT-LEGAL`. K-pop branding, playful game design, incentives, actual audience evidence, and marketing materials are considered together. An asserted 18–40 majority is not the whole analysis.

References:

- [FTC amended COPPA Rule](https://www.federalregister.gov/d/2025-05904)
- [FTC COPPA guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)
- [FTC age-verification policy statement, 2026-02-25](https://www.ftc.gov/news-events/news/press-releases/2026/02/ftc-issues-coppa-policy-statement-incentivize-use-age-verification-technologies-protect-children)

### 13.2 Data inventory posture

- Persistent device/session tokens, scores, behavior, coarse device metadata, IP-derived abuse signals, and analytics identifiers are treated as personal/pseudonymous data where applicable.
- Autocapture and session recording are off.
- Analytics initializes only under the approved consent/legal condition and uses the event whitelist in §17.
- No ad pixel or retargeting tag ships under this spec.
- Campaign attribution is allowlisted link metadata, not cross-site person tracking.
- Privacy notice states purposes, providers, retention, deletion path, and promotion-specific collection.
- Account attach, push, UGC, messaging, DBK/value transfer, and cross-product identity each require a new compliance review.

### 13.3 Promotion gate

No material prize promotion becomes active without:

1. Legal sponsor and responsible operator.
2. Eligible ages and geographies.
3. Official rules and classification of skill/chance/sweepstakes mechanics.
4. Dates, odds/scoring, prize descriptions, ARV, inventory, and no-purchase method where applicable.
5. Claim, verification, shipping, customs/tax, substitution, expiry, dispute, and fallback-winner procedure.
6. Privacy notice/data flow for claimants and processors.
7. Operations owner and tested runbook.

Reusing an earlier giveaway template means legal review and adaptation, not copying it unchanged.

---

## 14. Threat Model and Security Controls

| Threat                         | Required control                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| Cookie theft/fixation          | `__Host-` Secure HttpOnly cookie; random token; hashed storage; rotation/revocation; CSP            |
| Cross-site request/CSRF        | Same-origin/Origin validation, SameSite cookie, JSON-only mutation, no permissive CORS              |
| Multiple devices/Sybil         | Explicitly not solved by V1 device identity; therefore no valued leaderboard entitlement by default |
| Duplicate mobile retries       | Idempotency keys + DB unique constraints + return original result                                   |
| Concurrent cap bypass          | Row locks/transactions and unique slot/play keys                                                    |
| Forged scores                  | Cosmetic-only default; verification required before valued prizes                                   |
| Outcome/inventory manipulation | Server transaction, immutable odds version, inventory reservation, ops audit                        |
| Production dev controls        | Build-time exclusion and CI assertion; server never accepts forced outcome                          |
| API abuse                      | Device limits, short-lived rotating IP hash, provider/edge limits, schema validation                |
| XSS / supply chain             | Strict CSP, no contributor CDNs, pinned dependencies, minimized client dependencies                 |
| Service degradation            | Practice fails open where safe; counted/prize paths fail closed; kill switch                        |
| Privileged ops mistakes        | Human-authenticated scripts, confirmation prompts, reason required, before/after audit record       |

Security headers include CSP, `frame-ancestors`, `nosniff`, appropriate referrer policy, and permissions policy. Exact CSP includes only selected analytics endpoints after provider approval.

No public admin dashboard is required at initial volume. Human-run `scripts/ops/*` use Myosin-controlled credentials, display the exact target, require confirmation for mutations, and write `ops_audit`. If operations volume exceeds the runbook threshold, an authenticated admin surface becomes a separate scoped feature.

---

## 15. Performance Budgets

Budgets marked provisional become hard only after M0 measures a clean Next.js 16 production scaffold with the selected analytics loading strategy.

| Budget                                 | Provisional value                                                                                                                                                         | Enforcement                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home transferred JS, clean cache, gzip | ≤ 175KB — corrected M0 evidence (145.3KB modern-browser floor, `nomodule` polyfill excluded; ADR 0002 amendment); analytics fits inside or defers with a ≤25KB sub-budget | Count only scripts a modern browser executes: shared runtime + home route + initialized analytics; exclude game chunks and `nomodule` legacy scripts |
| Home total transfer, clean cache       | ≤ 500KB                                                                                                                                                                   | HTML/CSS/JS/fonts/images                                                                                                                             |
| Per-game JS chunk                      | ≤ 100KB gzip                                                                                                                                                              | Lazy route load                                                                                                                                      |
| Per-game art transfer                  | ≤ 300KB; claw ≤ 350KB                                                                                                                                                     | Versioned assets                                                                                                                                     |
| Decoded game assets                    | ≤ 16 MiB typical; claw target ≤ 32 MiB                                                                                                                                    | Dimension-based CI report + real-device peak check                                                                                                   |
| Canvas backing stores                  | DPR cap 2; document peak allocation                                                                                                                                       | Per-game report                                                                                                                                      |
| LCP / INP / CLS                        | ≤2.5s / ≤200ms / ≤0.1 at p75 field                                                                                                                                        | RUM after sufficient sample                                                                                                                          |
| Input-to-next-frame                    | ≤50ms p95 in lab                                                                                                                                                          | Instrumented game test                                                                                                                               |
| Frame delivery                         | 60fps target; 30fps floor on floor device                                                                                                                                 | p95 frame ≤33ms during representative run                                                                                                            |
| Long task                              | No game-created task >100ms in representative run                                                                                                                         | Performance trace                                                                                                                                    |
| Time to playable                       | Set hard value from M0/M1 device baseline                                                                                                                                 | Portal click → first accepted input                                                                                                                  |

`next build` output alone is not the transfer oracle. CI records actual preview resource transfers from a clean browser profile. Lighthouse is advisory/synthetic; regressions fail on size and deterministic lab thresholds, while Core Web Vitals are judged from field p75.

Game-card route prefetch is disabled unless measurement proves it does not preload game code/assets or materially increase paid landing transfer.

---

## 16. Testing and QA

### 16.1 Contract and game logic

- Contract conformance suite described in §6.1.
- Deterministic game-rule tests from `docs/games/*.md` vectors.
- End-at-most-once, repeated start, pause/resume, abort, and destroy tests.
- No leaked listener/timer/rAF assertions.
- Asset failure and unsupported-context tests.

### 16.2 Database/API

- Concurrent issuance/submission tests against a real test Postgres.
- Repeated idempotency-key tests return byte-equivalent logical results.
- Daily-slot local-midnight, DST, and timezone-change vectors under OD-1.
- Streak transaction rollback tests.
- Analytics-outbox commit/rollback, deduplication, publisher retry, and backlog tests; analytics HTTP is never observed before commit.
- Claw cap/inventory contention, response-loss retry, odds-version, out-of-stock, and claim-token tests.
- Privacy deletion and retention jobs.
- Authorization/origin/schema/rate-limit tests.

### 16.3 Browser and device

- Floor Android Chrome on a named physical device.
- Mid iPhone Safari and one oldest-supported iOS device.
- 360×640 and 375×667 viewports; tablet-ish responsive pass.
- Standalone-installed mode where supported.
- Audio unlock, mute, visibility pause, reduced motion, orientation change, font scaling, and zoom.
- Touch targets, keyboard/focus for supported controls, contrast, and DOM-game screen-reader smoke.

The exact OS/browser matrix is frozen only after `BROWSER FLOOR` is answered.

### 16.4 E2E and failure UX

- Portal boot and every registered game boot/first input/end panel.
- Practice/counting transitions under the adopted OD-1 policy.
- Server unavailable → practice-only behavior.
- Score failure → visible unsent state and same-page retry.
- Claw lost response → same outcome.
- Promotion paused/out of stock.
- Locale selection and missing-key CI.
- Campaign parameter allowlist and stripping of unexpected values.

No global coverage percentage is required. Contract, database invariants, game rules, promotion paths, and critical UX states require direct tests.

---

## 17. Analytics and Metric Definitions

### 17.1 Event interface

Gameplay calls a provider-neutral sink. Critical counted/prize events are written to `analytics_outbox` with the committed transaction and published post-commit; client events are behavioral only.

Approved event names:

```text
portal_view
game_open {gameId}
run_start {gameId, mode}
run_end {gameId, mode, submitted, scoreBucket, durationBucket}
counted_submit_result {gameId, accepted, reason}
streak_advance {bucket}
leaderboard_view {gameId}
install_help_view
install_action
locale_set {locale}
```

Reserved for the approved V1.1 Markets teaser tile and emitted only after that surface exists:

```text
markets_teaser_click {campaign?}
```

No raw score is required in third-party analytics. Prize outcomes, claim states, device IDs, run IDs, IPs, and free-form data are not sent to product analytics.

### 17.2 Definitions

- **Session**: provider-neutral 30-minute inactivity window; PWA standalone and browser sessions follow the same rule.
- **D1/D7 return**: a device with a qualifying `portal_view` on calendar day +1/+7 under the reporting timezone; reported with known device-reset limitation.
- **Counted completion**: committed counted run, not merely a start.
- **Games per session**: distinct `game_open` game IDs.
- **Streak rate**: devices eligible under the adopted OD-1 policy; denominator and timezone are displayed.
- **Paid cohort**: allowlisted campaign parameter passed from the main-site link; never inferred from a shared person cookie.

Provider selection, region, retention, DPA, consent mode, and final SDK configuration are deployment decisions under `EXT-LEGAL`. Analytics loads after consent/idle as required; gameplay cannot depend on it.

---

## 18. Deployment, Operations, and Observability

- Vercel project and DNS are Myosin-owned. Production: `arcade.aegyoarena.com`.
- Railway has separate dev/test/prod PostgreSQL services (ADR 0004). Preview deploys never use production writes or active promotion credentials.
- Drizzle migrations are committed and exercised against test DB before production.
- Promotion state, odds versions, and inventory are database records changed only through audited ops scripts—not mutable environment variables.
- Environment secrets include DB connection, session-token signing/rotation material if used, analytics config, and ops identity configuration. No forced outcome secret exists in production.
- CI: typecheck, lint/format, unit, Postgres integration, E2E smoke, contract conformance, bundle/asset report, production build.
- Vercel auto-deploys reviewed `main`; humans commit/push.

### 18.1 Minimum operations runbook

`docs/OPS_RUNBOOK.md` covers:

1. Pause/disable game or promotion.
2. Inspect top scores and flagged attempts.
3. View inventory and claims without exposing more claimant data than necessary.
4. Void/reinstate/reaward with reason and audit record.
5. Execute data deletion/retention jobs.
6. Roll back deploy or promotion config.
7. Respond to lost-response/duplicate-win reports.
8. Escalate legal, privacy, security, and fulfillment incidents.

### 18.2 Metrics and alerts

- API error/rejection rate by endpoint and reason.
- Counted slot conflict/expiry rate.
- Duplicate idempotency-key rate.
- Claw outcomes versus active odds version; inventory/reservation mismatch must remain zero.
- Claim aging and fulfillment backlog.
- Analytics outbox age/retry backlog; gameplay commit latency is measured independently from provider delivery.
- Database latency/connection failures.
- Client game-init failure and time-to-play.
- Field Core Web Vitals by device/locale/campaign where sample permits.

Alerts exist for cap/inventory invariant violation, promotion config change, outcome distribution drift, claim backlog, analytics-outbox backlog, DB failure, and a sudden game-init regression.

---

## 19. Milestones and Sequencing

Milestones deliberately integrate a thin retention spine before any external soft launch, while keeping game delivery as the visible gate. Adopted OD-2 fixes the markets handoff order; a later override is documented rather than awaited.

| Milestone                                           | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Exit criteria                                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — Scaffold + contract proof                      | Record adopted decisions; repo/app/CI; send `GAME_INTAKE.md`/rights note; define `InputBus`/`AudioBus`; hostile fixture; **minimum claw rAF/pause/resume refactor plus real-claw spike**; clean Next bundle baseline; Myosin preview deploy                                                                                                                                                                                                                                                                                                                                                                                                                | Contract v1 frozen only if both spikes pass; bus shapes and teardown tests exist; transfer budget accepted/adjusted from evidence; preview access works |
| M1 — Claw migration + identity/invariants           | Complete repeatable-start/destroy/host injection; host-only session; DB schema/migrations/outbox; idempotent counted claw outcome in gameplay-only mode; decoded-memory reduction; old-repo cutover plan; accept Frogger intake or trigger fallback                                                                                                                                                                                                                                                                                                                                                                                                        | Claw parity/conformance; retry returns same outcome; material-prize config absent; no parent cookie/localStorage ID; Frogger path fixed                 |
| M2 — Four core games + thin meta                    | Snake, Flappy, Jumper, Hangman from seeded rule docs; counted-slot plumbing; cosmetic leaderboard/streak under adopted OD-1; portal grid                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Four games pass rules, contract, failure UX, and device QA; full counted transaction/outbox works                                                       |
| M2.5 — Freebie Frenzy intake + shell migration      | Daidai's delivered microsite (accepted at review, 2026-07-18) rebuilt as a ShellLoopGame: pure deterministic logic + run.random, InputBus, external WebP assets (no 646KB monolithic HTML), Supabase/email/pseudonym path DELETED in favor of portal session + counted-run API + shared board policy, strings centralized, rule vectors (queue/combos/collisions/scoring/levels/end-once/seeded replay); intake source = the hash-recorded authoritative LOCAL archive (Daidai is a Myosin contributor per ADR 0006 — no external rights gate; shared-storage mirroring is housekeeping; live deployments are reference only, never the acceptance source) | Passes contract conformance + rules vectors + budgets; does NOT replace Frogger                                                                         |
| M3 — Frogger (Cross to the Concert) + six-game gate | Accepted Daidai intake or internal fallback; six-game catalog; core retention loop; allowlisted campaign attribution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Required five are playable; six total; controlled organic soft-launch eligible only when external release gates pass; no prize feature exposed          |
| Handoff — Markets modal                             | After the M3 retention gate, the same developer switches or a separate owner begins the homepage modal project                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Arcade work remaining is explicit; no arcade code is copied into Daebak                                                                                 |
| M4 — Public hardening                               | Approved launch locales; installability; accessibility; performance; analytics/privacy config; ops rehearsal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Organic/public launch criteria met; field measurement starts                                                                                            |
| M5 — Paid-traffic readiness                         | Field regressions fixed; paid cohort instrumentation; promotion gate complete if prizes enabled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Paid traffic approved by growth + ops; prize mode remains off unless §13.3 passes                                                                       |
| V1.1                                                | Photo Chase, Spot the Bias, static Markets teaser tile + reserved click event, optional install/offline research, pt-BR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Separate scope review; teaser is a plain link with no Daebak import/shared identity                                                                     |

M3 is not permission to launch prize promotions. M4/M5 do not delay the markets handoff: adopted OD-2 starts that separate work after the M3 retention gate while arcade hardening continues as owned capacity allows.

---

## 20. Risks

| Risk                                            | Mitigation / tripwire                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Product direction changes later                 | Adopted defaults are non-prize and policy-versioned; overrides are ADRs, not hidden code flags |
| Contract overfit to first-party games           | Claw + hostile fixture before freeze; Frogger is second external check                         |
| Frogger delivery misses gate                    | Intake now, end-of-M1 cutoff, internal fallback already authorized by OD-8                     |
| Prize dispute or over-allocation                | Cosmetic boards by default; atomic inventory; immutable rules/odds; audited claims             |
| Device identity mistaken for a person           | Spec/UI use device language; no one-human prize entitlement without added verification         |
| Child/privacy posture misclassified             | Counsel gate; minimal data; host-only token; retention/deletion; analytics conditional         |
| Claw transfer improves but memory still crashes | Decoded-memory budget and physical floor-device trace                                          |
| PWA complexity consumes sprint                  | Manifest-only V1; no service worker/offline queue                                              |
| Performance budget is framework fiction         | M0 clean-build/real-transfer measurement before hard acceptance                                |
| IP rights assumed from delivery                 | Contribution confirmation and asset/content register are intake gates                          |
| Soft launch burns audience without retention    | Thin counted/streak/board loop exists before controlled organic launch under adopted OD-2      |

---

## 21. Decision Record and Approval Checklist

### 21.1 Change control

OD-1 through OD-8 and the supporting defaults in §3.1 are effective now. No Simon reply is required to begin or continue implementation. If Simon or another accountable owner later makes a different decision:

1. Record the override in `docs/decisions/` with owner/date/reason.
2. Identify copy, analytics, schema/policy, migration, and test impact before changing behavior.
3. Increment the affected policy version; never reinterpret historical slots, streaks, scores, or promotion outcomes under a new rule.
4. Keep the existing safe behavior active until the override's required work and release gates pass.

### 21.2 External confirmations

- Contribution-rights posture resolved: current contributors are internal Myosin work product (ADR 0006); written confirmations become required only if a genuinely external contributor is added.
- Browser/OS floor approved from actual audience/device evidence.
- Counsel approves/corrects audience classification, privacy notice, consent behavior, providers, and retention.
- Myosin production DNS/Vercel/Railway access and incident owner confirmed.
- Native/fan-fluent review completed for every enabled locale.
- Any future material-prize mode separately receives sponsor, rules, inventory, claim, and fulfillment approval under §13.3.

### 21.3 Spec approval criteria

M0/M1 implementation is approved under this DRAFT. The document may move to technically APPROVED when:

1. The runtime contract, including `InputBus`/`AudioBus`, passes the M0 claw and hostile-fixture spikes.
2. The database schema includes the specified unique constraints, state machines, outbox, and transaction tests.
3. Game intake, seeded rules, and contribution-rights documents are issued.
4. The measured M0 Next.js bundle/device baseline replaces or confirms provisional budgets.

Controlled organic public release additionally requires all applicable §3.1 external gates. The released configuration must contain no active `material_prize` promotion.

---

## 22. Future — Design Later, Do Not Prebuild

- Cross-device accounts and prize-eligible identity.
- Cross-product audience recognition or a DBK bridge.
- Valued leaderboard contests and deterministic replay infrastructure.
- Giveaway entries and drawing integrations.
- Push notifications.
- Full offline/service-worker support.
- Public admin/fulfillment product.
- Additional games beyond approved fast-follows.

V1 records arcade facts for its own operation. It does not shape tables or cookies around an undefined markets/DBK consumer.

---

_End of v0.2.1-DRAFT._
