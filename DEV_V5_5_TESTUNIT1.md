# Stonefish v5.5 testunit1

Development-only test unit.

Invariant: Stonefish v5.5 testunit1 is Stonefish v5 plus ARMX-preview, and nothing else.

- Stonefish baseline: `Stonefish_v5.js`.
- No Stonefish v5 Pro evaluation/search/geometry features are inherited.
- No v5 weights, candidate limits, move ordering, search depth, tie-breaking, or base behavior are intentionally changed.
- ARMX-preview is a separate critic model/module loaded after v5.
- ARMX-preview uses 3-ply base analysis and may selectively extend one forcing continuation to at most 4 ply.
- ARMX-preview reviews only the top three v5 candidates, examines at most two replies and two continuations, and has a hard 72-node review budget.
- The fourth ply is exceptional rather than full-width: one reply only, after a forcing third-ply continuation.
- ARMX-preview applies only a small bounded risk penalty to v5's existing candidate scores.
- If ARMX is absent, v5.5 testunit1 falls back to unchanged v5 behavior.
- ARMX-preview is intentionally conservative and incomplete so later ARMX versions have clear room to improve in depth, strategic understanding, candidate coverage and authority.
- Test-unit files are development artifacts and are not part of the normal release/UI path unless explicitly wired in for a dev test.

Development benchmark: `benchmark_v5_5_testunit1.js` checks the 3/4-ply contract, ARMX connection, hard node budget, v5 fallback parity, latency overhead and a small v5.5-vs-v5 smoke match.
