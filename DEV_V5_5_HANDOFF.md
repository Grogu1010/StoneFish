# Stonefish v5.5 development handoff

This file is the durable continuation point for the active v5.5 / ARMX-preview work. Update it when the architecture, hard targets, or confirmed benchmark state changes materially.

## Hard release targets

The required hierarchy is:

`v5 Pro < v5.5 No ARMX < v5.5 + ARMX`

Per 100 controlled games on varied opening seeds with color swaps:

- v5.5 No ARMX must score at least **65 actual wins / 100 vs v5 Pro**.
- v5.5 + ARMX must score at least **85 actual wins / 100 vs v5 Pro**.
- v5.5 + ARMX must score at least **65 actual wins / 100 vs v5.5 No ARMX**.
- Draws do not count toward those win targets.
- Both v5.5 variants must average at least **3x less real engine think-time per move than v5 Pro** in their direct games.

Do not treat 8-game diagnostics as proof. The final gate needs 100+ games.

## Architecture

### Native v5.5

`Stonefish_v5_5_search.js` uses v5 Pro knowledge with a selective five-ply Guarded PVS search. Current core configuration is 7 semifinalists, 4 root candidates, 2 exact root keepers and branch widths `[0,1,2,2,4]`, with PVS, TT and LMR.

`Stonefish_v5_5_refutation_guard.js` is a native v5.5 feature named **Refutation Guard**. The name is deliberately not tied to a ply count. In the current five-ply model it looks outside the normal reply beam for a legal opponent resource, injects that reply into the same v5.5 search and can only lower a candidate after verification. It is not ARMX.

`getStonefishV55Testunit1NoARMXMove` is the exact same native v5.5 host, including Refutation Guard, with only the separate ARMX model bypassed.

### ARMX-preview

ARMX-preview is a separate per-game opponent-adaptation model. It is not a search critic and does not share Stonefish's evaluator.

Its job is to observe the current opponent during the current game, learn which behaviors they choose or avoid and what kinds of moves/exchanges have improved or worsened the game, then apply bounded learned adjustments to already-searched v5.5 finalists. Its profile resets between games/rounds.

Current model version on main: **preview-adapt5** in `ARMX_preview_fast.js`.

Important current behavior:

- Tracks captures, trades, rook/queen/minor exchanges, simplification, checks, king attacks, pawn pushes, castling, quiet moves, advances and retreats.
- Tracks what reply types the opponent chooses when those behaviors are available.
- Uses an independent lightweight material/activity/king-zone/pawn-advance evaluation for outcome learning.
- Learns exchange episodes over multiple plies, so a sequence such as a rook exchange can be recognized even when no single move is literally rook-captures-rook.
- Inferred multi-ply exchange labels receive reduced weight (`episodeFeatureWeight = 0.55`).
- Candidate exchange invitations are now connected to learned exchange outcomes and weighted by how often the opponent actually accepts that behavior (`responseOutcomeWeight = 0.65`).
- Native mate/deep-search truth still wins: ARMX changes are gated by host-score gap, deep-score sacrifice, evidence, confidence, early-game confidence and signal quality.

`Stonefish_v5_5_testunit1.js` currently gives ordinary learned differences 1.25x voting weight. Mature high-confidence candidate pairs with a large learned signal edge may use 1.60x contrastive voting weight; all safety gates remain active.

## Benchmark instrumentation

The browser dev test and CI benchmark report, per model and matchup:

- average engine time per move
- average moves made per game
- average engine-only time per game

Opponent think time is excluded. The release speed target uses real in-game average time per move, not the isolated latency microbenchmark.

## Last confirmed diagnostic before adapt5

Workflow run `34748680629`, commit `d23d3a23301446af5600f857ab5d74b4cabd71dc` (ARMX preview-adapt4):

- v5.5 + ARMX vs v5 Pro: **6W-2L**
- v5.5 No ARMX vs v5 Pro: **6W-2L**
- v5.5 + ARMX vs v5.5 No ARMX: **4W-4L**
- No-ARMX real-game speedup vs Pro: **3.041x** on that runner
- ARMX real-game speedup vs Pro: **2.238x**
- ARMX override rate vs Pro increased to about **1.79%** after multi-ply exchange learning.
- ARMX direct A/B still failed to separate from the host, so the hierarchy is not yet satisfied.

Runner timing is noisy; a single 3.04x quick run is not robust speed proof.

## Recent continuity commits

- `095f86f72c1483b5387ea375a2f53540459021a6` — Let mature ARMX evidence earn contrastive voting weight
- `547442b64862dd732408b6177d05e33f1dba9cf4` — Reuse ARMX replay evaluation between observed plies
- `d23d3a23301446af5600f857ab5d74b4cabd71dc` — Teach ARMX to learn multi-ply exchange episodes
- `3e3367983a5215230b1c671b12fb2151da8c7bf8` — Connect ARMX exchange history to opponent acceptance

## Immediate next step

Wait for the CI benchmark for `3e3367983a5215230b1c671b12fb2151da8c7bf8` (preview-adapt5). Compare especially ARMX-vs-NoARMX, ARMX override events/rejections, `offer-*` reasons and ARMX real-game speed. If direct A/B remains at or below 50%, improve the opponent model's candidate-specific discrimination rather than merely increasing multiplier size. Do not weaken the deep-score safety gate to manufacture overrides.

Every meaningful subsequent improvement should be committed separately on `main` so this handoff remains recoverable from git history.