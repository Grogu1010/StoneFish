# Stonefish v5.5 testunit1

Development-only test unit.

Invariant: Stonefish v5.5 testunit1 must be Stonefish v5 plus ARMX-preview, and nothing else.

- Stonefish baseline: `Stonefish_v5.js`.
- No Stonefish v5 Pro evaluation/search/geometry features are inherited.
- No v5 weights, candidate limits, move ordering, search depth, tie-breaking, or base behavior are intentionally changed.
- ARMX-preview is a separate critic model/module.
- ARMX-preview uses 3-ply base analysis and may selectively extend to at most 4 ply.
- ARMX-preview is intentionally conservative and incomplete so later ARMX versions have clear room to improve.
- Test-unit files are development artifacts and are not part of the normal release/UI path unless explicitly wired in for a dev test.
