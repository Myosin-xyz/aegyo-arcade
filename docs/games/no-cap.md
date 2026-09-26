# NO CAP integration

NO CAP is a 90-second swipe game adapted from DaiDai's delivery in
`Downloads/no-cap`. The Arcade host supplies the shared account, practice and
counted runs, pause/mute controls, and saved score. No separate login,
subscription gate, or client-supplied leaderboard score is used.

The delivered scoring is preserved: normal fake +15, silver +40, gold +100,
multiplied by the current 0.7-second combo; slicing genuine merch removes up
to 20 points and resets the combo. The game simulation runs at fixed 60 Hz so
official attempts can be replayed on the server from a seed and compact swipe
events. Pointer moves are sampled once per simulation tick before both live
scoring and recording, so high-refresh devices cannot outrun the trace. Visual
particles and sound are presentation only. The one-million-point
generic run cap is an abuse bound, not a target score or leaderboard threshold.

The supplied point thresholds are a _proposal for a future monthly round_:
score 0 → 0 points, 50 → 5, 800 → 10, and 2,000 → 20. Arcade's existing
calibration table expresses this directly; it does not need the handoff's
weekly `tierFor` package or its separate backend stub. A new round must list
`no-cap` explicitly. Existing round rules and standings remain unchanged, and
the Full Arena requirement automatically uses that round's listed games.

Before making NO CAP eligible for a prize round, operators should playtest the
thresholds on real devices, review the replay verifier's score acceptance, and
publish the new round's rules. The handoff's estimated score ceiling is not a
hard ceiling because its combo multiplier is uncapped.
