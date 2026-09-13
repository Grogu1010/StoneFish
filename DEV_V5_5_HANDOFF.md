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
- Candidate exchange invitations are connected to learned exchange outcomes and weighted by how often the opponent actually accepts that behavior (`responseOutcomeWeight = 0.65`).
- Native mate/deep-search truth still wins: ARMX changes are gated by host-score gap, deep-score sacrifice, evidence, confidence, early-game confidence and signal quality.

`Stonefish_v5_5_testunit1.js` currently gives ordinary learned differences 1.25x voting weight. Mature high-confidence candidate pairs with a large learned signal edge may use 1.60x contrastive voting weight; all safety gates remain active.

## Benchmark instrumentation

The browser dev test and CI benchmark report, per model and matchup:

- average engine time per move
- average moves made per game
- average engine-only time per game

Opponent think time is excluded. The release speed target uses real in-game average time per move, not the isolated latency microbenchmark.

## Latest expanded confirmation — preview-adapt5

Workflow run `34748872163`, commit `cd300e9b849e8069eb348402fcf4ab847da268f9`, 40 games per main matchup with 16-game ARMX diagnostics:

- v5.5 + ARMX vs v5 Pro: **20W-15L-5D** — 50% actual wins, 56.25% score.
- v5.5 No ARMX vs v5 Pro: **18W-16L-6D** — 45% actual wins, 52.5% score.
- v5.5 + ARMX vs v5.5 No ARMX: **21W-17L-2D** — 52.5% actual wins, 55% score.

This is the first expanded test where all three hierarchy flags are positive: native v5.5 scores above Pro, ARMX scores above its host, and ARMX outscores No-ARMX against Pro. That is real progress, but none of the requested actual-win targets are met yet.

Equivalent target counts over 40 games would be:

- No ARMX vs Pro: **26 wins required**, got 18.
- ARMX vs Pro: **34 wins required**, got 20.
- ARMX vs No ARMX: **26 wins required**, got 21.

Real-game direct speed in the same 40-game run:

- No-ARMX vs Pro: **3.060x** — passes the 3x target on this run.
- ARMX vs Pro: **2.599x** — still below target.
- Isolated latency remains much faster (4.61x No-ARMX / 5.54x ARMX), so ARMX's direct-game speed ratio is affected strongly by game trajectory as well as its own small per-move overhead.

Aggregate move timing across all games in that run:

- v5 Pro: 23.79 ms/move
- v5.5 No ARMX: 7.81 ms/move
- v5.5 + ARMX: 8.10 ms/move

The ARMX model itself now adds only a few percent of per-move overhead relative to the host in direct A/B, but the release metric remains the direct Pro matchup and must still reach 3x.

Expanded ARMX diagnostics showed the new adaptation is active: `offer-capture` and `offer-simplify` are among the most common reasons, and multi-ply exchange notes are being learned. ARMX's direct advantage is modest rather than accidental-looking, but it is nowhere near the 65% / 85% win requirements yet.

## Recent continuity commits

- `095f86f72c1483b5387ea375a2f53540459021a6` — Let mature ARMX evidence earn contrastive voting weight
- `547442b64862dd732408b6177d05e33f1dba9cf4` — Reuse ARMX replay evaluation between observed plies
- `d23d3a23301446af5600f857ab5d74b4cabd71dc` — Teach ARMX to learn multi-ply exchange episodes
- `3e3367983a5215230b1c671b12fb2151da8c7bf8` — Connect ARMX exchange history to opponent acceptance
- `43cbc3760c423db235ca6dd8bb1d6c32468d2771` — Add durable v5.5 development handoff state
- `cd300e9b849e8069eb348402fcf4ab847da268f9` — Run expanded ARMX adapt5 confirmation
- `0a435ecebdd10c1c8fbea11c238aeb069cb36f2d` — Restore quick v5.5 iteration workflow

## Immediate next steps

1. **Strengthen native v5.5 first.** The expanded No-ARMX result is only 18 wins / 40 vs Pro, far below the 26 / 40 equivalent of the 65-win target. Do not rely on the earlier 6-2 quick result.
2. Keep ARMX-preview: the 40-game direct A/B is now positive at 21-17-2 and ARMX also improves the Pro result from 18 to 20 wins. Refine it rather than discarding it.
3. Optimize ARMX candidate reply-opportunity work. It currently enumerates replies for reviewed candidates even before relevant opponent-choice/outcome evidence is mature; skipping provably-zero contribution work is a promising behavior-preserving speed optimization.
4. Improve candidate-specific discrimination rather than simply increasing multipliers or weakening the deep-search safety gate.
5. After meaningful strength changes, use quick 8-game diagnostics for iteration and return to a 40-game confirmation before any 100-game release-gate run.

Every meaningful subsequent improvement should be committed separately on `main` so this handoff remains recoverable from git history.