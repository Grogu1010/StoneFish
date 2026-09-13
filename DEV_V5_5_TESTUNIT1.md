# Stonefish v5.5 testunit1

Development-only test unit.

Invariant: Stonefish v5.5 testunit1 is Stonefish v5 Pro plus ARMX-preview, and nothing else.

- Stonefish baseline: the normal fully patched `Stonefish_v5 Pro` path.
- v5 Pro runs its normal candidate generation, scoring and five-ply selective search first.
- ARMX-preview is a separate second-opinion model loaded after the Pro speed/geometry/runtime layers.
- ARMX-preview uses 3-ply base analysis and may selectively extend dangerous lines to at most 4 ply.
- ARMX deliberately searches broader than Pro: it reviews Pro's deep-searched finalists plus additional candidates outside that finalist beam.
- ARMX uses a counterplay-heavy evaluation so it can disagree with Pro for concrete reasons rather than merely duplicating Pro's score.
- ARMX may overturn Pro's move only when its preferred candidate clears a confidence/gain threshold.
- ARMX has a hard 320-node review budget so it remains a bounded second pass rather than a second full engine.
- If ARMX is absent, v5.5 testunit1 falls back to exact Stonefish v5 Pro behavior.
- ARMX-preview is intentionally still limited to 3/4 ply so later ARMX versions have meaningful room to improve.
- Test-unit files remain development artifacts; v5.5 appears only in the Developer round-robin menu, not the normal opponent selector.

`benchmark_v5_5_testunit1.js` checks the baseline invariant, exact Pro fallback parity, ARMX connection/node budget, latency, move changes, and varied-opening v5.5-vs-v5-Pro head-to-head behavior.
