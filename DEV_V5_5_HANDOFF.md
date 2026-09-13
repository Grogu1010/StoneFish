# Stonefish v5.5 development handoff

This file is the durable continuation point for the active v5.5 / ARMX-preview work. Update it when the architecture, hard targets, or confirmed benchmark state changes materially.

## Hard release targets

Required hierarchy:

`v5 Pro < v5.5 No ARMX-preview < v5.5 + ARMX-preview`

Per 100 controlled games on varied opening seeds with color swaps:

- v5.5 No ARMX-preview must get at least **65 actual wins / 100 vs v5 Pro**.
- v5.5 + ARMX-preview must get at least **85 actual wins / 100 vs v5 Pro**.
- v5.5 + ARMX-preview must get at least **65 actual wins / 100 vs v5.5 No ARMX-preview**.
- Draws do not count toward those win targets.
- Both v5.5 variants must average at least **3x less real engine think-time per move than v5 Pro** in their direct games.

Eight-game runs are diagnostics only. Final proof requires 100+ games.

## Architecture

### Native v5.5

`Stonefish_v5_5_search.js` uses v5 Pro knowledge with a selective five-ply Guarded PVS search. Current core: 7 semifinalists, 4 root candidates, first 2 root finalists searched exactly, roots 3-4 proof-windowed and fully re-searched only when they can challenge, branch widths `[0,1,2,2,4]`, PVS, TT and LMR.

`Stonefish_v5_5_refutation_guard.js` is a native feature named **Refutation Guard**. The name is deliberately not tied to a ply count. In current v5.5 it uses the five-ply horizon, looks outside the normal reply beam for a legal opponent resource, injects that reply into the same search, and can only lower a candidate after verification. It is not ARMX-preview.

`getStonefishV55Testunit1NoARMXMove` is the exact same native host, including Refutation Guard, with only the separate ARMX-preview model bypassed.

### ARMX-preview

The canonical model file is **`ARMX-preview.js`**. ARMX-preview is a separate per-game opponent-adaptation model, not a Stonefish search feature. It has no search tree and does not use Stonefish evaluation as its model.

Its job is to observe the current opponent during the current game, learn what they choose or avoid and what has worked or failed against them, then apply bounded learned adjustments to already-searched v5.5 finalists. Its profile resets between games/rounds.

Current model version: **`preview-adapt7-response`**.

Current behavior:

- Learns captures, trades, rook/queen/minor exchanges, simplification, checks, king attacks, pawn pushes, castling, quiet moves, advances and retreats.
- Learns multi-ply exchange episodes rather than only literal one-move trades.
- Tracks what reply types the opponent chooses when those behaviors are available.
- Tracks whether offering the opponent a capture/trade/simplification was actually accepted and the position outcome 2 and 4 plies later in a separate `acceptedResponseEffects` memory.
- Candidate exchange invitations use opponent acceptance propensity, historical exchange results, and direct accepted-response outcomes.
- Normally reviews the top two already-searched v5.5 finalists. Once the per-game profile is mature it may inspect finalist three, but that third finalist is admitted only with signal >= +0.20, confidence >= 0.90 and evidence >= 5.5.
- Uses bounded multipliers (`maxMultiplierDelta = 0.18`).
- Native mate/deep-search truth always wins through host-gap, deep-sacrifice, evidence, confidence, early-game and signal-quality gates.

`Stonefish_v5_5_testunit1.js` uses ordinary learned differences at 1.25x decision weight. Mature high-confidence pairs with a learned signal edge >=0.30 may use 1.60x contrastive decision weight; all safety gates stay active.

## Benchmark instrumentation

Browser dev tests and CI report per model/matchup:

- average engine time per move
- average moves per game
- average engine-only time per game

Opponent think time is excluded. The release speed target uses real in-game average time per move, not isolated latency.

## Latest expanded confirmation — preview-adapt7-response

Workflow run **`34750116643`**, job **`103705025845`**, workflow commit **`a018c0314024ca58ac10ed88279952225399acbc`**, 40 games per main matchup and 16 ARMX-preview diagnostic games.

Strength:

- v5.5 + ARMX-preview vs v5 Pro: **20W-15L-5D** — 50% actual wins, 56.25% score.
- v5.5 No ARMX-preview vs v5 Pro: **18W-16L-6D** — 45% actual wins, 52.5% score.
- v5.5 + ARMX-preview vs v5.5 No ARMX-preview: **21W-17L-2D** — 52.5% actual wins, 55% score.

All hierarchy flags are positive: host beats Pro by score, ARMX-preview beats host by score, and ARMX-preview outscores host against Pro. These top-line results exactly match the prior adapt5 40-game confirmation, so adapt7 preserved the positive hierarchy while adding more specific causal opponent memory.

Equivalent target counts over 40 games:

- No ARMX-preview vs Pro: **26 required**, got 18.
- ARMX-preview vs Pro: **34 required**, got 20.
- ARMX-preview vs No ARMX-preview: **26 required**, got 21.

Therefore none of the requested win-count gates are met yet.

Real-game direct speed in this run:

- No ARMX-preview vs Pro: **3.036x** — narrowly passes 3x.
- ARMX-preview vs Pro: **2.565x** — fails 3x.
- In direct ARMX-preview vs No-ARMX-preview play, ARMX-preview averaged 7.480 ms/move and host 7.121 ms/move, only about 5% adaptation overhead. The poor direct-Pro ratio is therefore driven substantially by different game trajectories, not just ARMX-preview computation.

Aggregate timing across both matchups each model participates in:

- v5 Pro: **23.402 ms/move**, 66.0 moves/game, 1544.5 ms engine-only/game.
- v5.5 No ARMX-preview: **7.638 ms/move**, 56.175 moves/game, 429.1 ms engine-only/game.
- v5.5 + ARMX-preview: **8.233 ms/move**, 58.0 moves/game, 477.5 ms engine-only/game.

16-game focused ARMX-preview diagnostics:

- vs Pro: **10W-3L-3D**.
- vs No ARMX-preview: **8W-8L**.
- Accepted-response evidence (`accepted-capture`, `accepted-trade`, `accepted-simplify`) is active in real decisions.
- A previously bad Pro-side override was rejected by the existing `signal-quality` gate after causal accepted-response evidence lowered the challenger signal; that diagnostic game became a draw rather than a loss. This is useful safety evidence, but not sufficient proof of added strength.

## Current teacher/candidate-selection state

The current 80-position teacher run reported roughly:

- pool coverage: **0.8125**
- top1: **0.5875**
- top2: **0.65**
- top3: **0.75**
- top4: **0.80**

Previous teacher runs on nominally unchanged host code have varied by a few percentage points, so do **not** tune from tiny teacher deltas until benchmark determinism is checked. The current host still appears to miss the teacher move from its cheap semifinalist pool around 19-21% of the time.

A promising next host experiment is a selective eighth-semifinalist rescue: normally score only 7, but tactical-score scout-rank 8 when its scout margin to rank 7 is small or it is a cheap forcing move. First measure this only in the teacher benchmark; do not widen the engine blindly.

## Important recent commits

- `47949216fa01011739982bdd060b604c5b9e4748` — skip zero-value ARMX-preview reply scans
- `86d577c1110685b2bafc6b8c43b420c9f133eac8` — create canonical `ARMX-preview.js`
- `91e87f8bf257b821cf99e2ad5382132d122908f4` — dev worker loads canonical ARMX-preview file
- `e795272195b7185ca01e81ba4708bfd95bcd873c` — CI uses canonical ARMX-preview path
- `3492c0e475f3be0510a072d8883b54a32c71b6bf` — old `ARMX_preview_fast.js` becomes compatibility shim
- `3b83d58793760c4cc39ecc702222900c08b387fd` — mature profiles may inspect third finalist (too permissive alone)
- `aad53a23246f48914e93369956e1ce3fa5b12c7a` — require strong positive evidence for third finalist
- `18b88e3e76e133b96444a2cc7bf9a0f83d49b2f1` — add causal accepted-response outcome memory (`preview-adapt7-response`)
- `a018c0314024ca58ac10ed88279952225399acbc` — run 40-game adapt7 confirmation
- `3f2c63093320a8abbc88cbffbcb994fcb2d5c537` — restore quick 8-game iteration after confirmation

## Immediate next steps

1. Keep `preview-adapt7-response` as the current ARMX-preview baseline. Do not increase multipliers blindly.
2. Strengthen native v5.5: 18/40 actual wins vs Pro is still far below the target-equivalent 26/40.
3. Before tuning tiny teacher differences, make/verify the teacher benchmark deterministic.
4. Add teacher-only diagnostics for a selective scout-rank-8 rescue (close scout margin and/or forcing move) and measure teacher coverage versus trigger rate.
5. If the rescue improves teacher retention cheaply, implement it in native v5.5 and run the quick 8-game strength/speed loop before another 40-game confirmation.
6. ARMX-preview direct Pro speed remains below 3x. Since direct host overhead is small, improve host efficiency/trajectory and avoid sacrificing ARMX-preview behavior merely to game timing.
7. Housekeeping: benchmark scripts still load the old compatibility shim; move them to `ARMX-preview.js`, then delete the shim in separate commits.

Every meaningful improvement must be committed separately on `main` so a future chat can continue from git history.