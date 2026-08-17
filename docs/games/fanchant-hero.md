# Game Rules - Fanchant Hero

**Status**: IMPLEMENTED - DaiDai delivery port (2026-08-17)

**Surface**: `canvas`, shell-owned fixed 60Hz loop

**Reference box**: 360x640 logical px

## Product rules

- Concert goodies fall down four lanes. Touch a lane, or press D/F/J/K,
  when its goodie reaches the neon judgement line.
- Timing windows are PERFECT +/-70ms, GOOD +/-140ms, and OK +/-220ms.
- A miss resets the combo. A successful catch advances an original
  32-note synthesized hook; PERFECT adds a fifth-above harmony.
- The seeded chart moves through warm-up, build, and groove phases. It
  begins sparse and slow, then adds density, doubles, and faster approaches.
- The chart is capped at 115 notes and lasts 120 beats at 120 BPM, plus
  count-in and tail. The result reports score, max combo, accuracy, and
  an S/A/B/C/D grade; accuracy of at least 88% earns ENCORE.

## Scoring and server envelope

- PERFECT: 100 points; GOOD: 60; OK: 30.
- Every catch also adds `2 x current combo`.
- With the 115-note hard cap, a full PERFECT combo reaches exactly
  **24,840**, which is also the shared server score ceiling.
- Accuracy and grade are deterministic projections rendered by the game.
  The frozen V1 platform persists the canonical integer score only.

## Portal adaptations

- Chart generation uses `RunContext.random`, replacing the prototype's
  `Math.random()` mechanics for replayable counted runs.
- The standalone backend/username/two-plays-per-day stub is removed in
  favor of the shared counted-run, streak, and leaderboard flow.
- Fourteen transparent PNG goodies are exported to lazy lossless WebPs.
- The shell owns the fixed loop, pause/resume, input listeners, and WebAudio
  lifetime. No game-created animation frame, timer, or audio context remains.
- Fanchant Hero deliberately does not reuse an unrelated background loop:
  the supplied 120-BPM metronome and original catch melody stay aligned with
  the procedural chart until a final licensed beat-mapped track exists.

## Required vectors (implemented)

1. Same seed produces the same chart; every lane is valid and note count is
   no greater than 115.
2. Exact PERFECT/GOOD/OK boundary scoring.
3. Miss judgement and combo reset.
4. Accuracy and grade thresholds.
5. 120-beat terminal condition and exact 24,840 score ceiling.

## Intake record

Local source folder: `fanchant-hero` (kept outside the served tree).
Complete source-tree digest, calculated from the sorted per-file SHA-256
manifest with `.DS_Store` excluded:
`1a7927ec35502680846053de7129d42ce7b82a853fb0778572e01ab85f8cebe3`.

Core delivery hashes:

- `README.md` - `2e1aa58586f74113c5949b60c36f2ecf13521be0de6077a5a6dbbdc8edff1e70`
- `PRODUCT_BRIEF.md` - `389050b2c143759190860e9641fdebe7137d04f626a2bdd25feaa40e743fc476`
- `BACKEND_INTERFACE.md` - `407cb8338fe1fe451f55e6c964d785ef97df416c208df02d9c72401962271df0`
- `js/config.js` - `e602571f45b7d21393b338c44067533ab3477f12bdc87fcb58581957db5953e6`
- `js/game.js` - `f7ad407c3914b3733146c8f526d1c8b205c78871ae71554d29f49e069d4097a4`
- `css/style.css` - `c2f1f3d0ad0e6f2da9bc49649e3a5b34593739a5abf8a859878a58eb58bb8ce7`

DaiDai is an internal Myosin contributor under ADR 0006. The delivery
identifies the goodies and melody as original/generic and free of real-group
marks, likenesses, lyrics, and copyrighted tunes.
