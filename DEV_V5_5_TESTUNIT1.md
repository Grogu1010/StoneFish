# Stonefish v5.5 rolling testunit1

The two Developer-menu models share exactly the same native host, evaluation, search budget, and candidate scores. Only '5.5(testunit1)' invokes the separate ARMX-preview opponent model. Neither model is released in the normal opponent selector.

## Native search

'Stonefish_v5_5_native.js' considers all legal root moves using iterative PVS, capture quiescence, tapered positional evaluation, move ordering and a per-search transposition table. It preserves three exact root alternatives when available. Completed depth two is the minimum; subsequent iterations use a 1,200-node budget and a four-ply maximum, with quiescence beyond that. Incomplete iterations are discarded. Mate, stalemate, repetition and fifty-move outcomes take precedence over static evaluation. Only exact root scores may be adapted.

The former beam search and Refutation Guard remain available to historical diagnostics; they are no longer the active host. The native evaluation is independent of v5 Pro. The released v5 Pro implementation is unchanged.

## ARMX-preview

ARMX learns opponent choices and observed short-term outcomes in the current game. It has no search tree and no opponent identity shortcut. Profiles are isolated by game and side, reset after history replacement, and ignore supplied opening moves. Accepted-exchange memory requires the opponent to capture the offered piece. Sparse choice rates are regularized and confidence counts distinct observations, not correlated feature labels.

## Measurement

Use 'GAMES=100 RELEASE_GATE=1 node benchmark_v5_5_testunit1.js' (environment-variable syntax depends on shell). All three matchups must run at least 100 games with color swaps. Required actual wins are 65/100 No ARMX vs Pro, 85/100 ARMX vs Pro, and 65/100 ARMX vs No ARMX. Both variants must average at least 3x faster real engine time per move than Pro. Draws do not count as wins.

'RESULT_JSON' saves complete move records, openings, timings, and hashes of the exact source loaded before play. 'START_INDEX' selects additional varied opening pairs. 'MATCHUP' supports focused diagnostics, which cannot satisfy the release gate. Browser tests use the same ten-ply varied opening generator and 360-ply limit as the command-line benchmark.

## Latest development checkpoint

The first integrated 100-game confirmation scored **92W-7L-1D** No ARMX vs Pro, **91W-6L-3D** ARMX vs Pro, and **42W-44L-14D** ARMX vs No ARMX. ARMX was **4.683x** faster than Pro. All matchups used 50 distinct openings with color swaps.

The current ARMX calibration matches the new centipawn score scale: require a 2-point adapted lead instead of 12, while tightening the native score gap to 40 and maximum deep-score sacrifice to 25. This changes only ARMX's voting gates; the native engine is frozen. Its 100-game confirmation scored **90W-8L-2D** vs Pro and **47W-43L-10D** vs No ARMX, with **4.702x** direct speed versus Pro. The unchanged No-ARMX control reproduced **92W-7L-1D**. Evidence is saved in `benchmarks/v5_5/armx-calibrated-100.json.gz`; the previous confirmation is `native-baseline-100.json.gz`. Both contain complete move histories and loaded-source fingerprints.

The user's separate 10,000-game browser test of the preceding build supports the same diagnosis: ARMX scored 1,427W-1,485L-422D against No ARMX across 3,334 games; versus Pro, ARMX scored 3,082/3,333 wins and No ARMX 3,097/3,333. Treat those timings as uncontrolled, as requested. Focus further development on ARMX while keeping the base fixed. The **65 actual wins / 100 vs No ARMX gate is still unmet**, so 5.5 remains development-only.

### Per-game reset confirmation and further ARMX experiments

The user explicitly requires **empty notes at the start of every game**, even against the same opponent. Cross-game learning is not permitted. The memory contract now checks consecutive rounds with identical supplied openings, both with separate game objects and with a reused/reset object. Neither round inherits the previous round's observations or adjustments.

The unchanged published calibration scored **48W-44L-8D** against No ARMX on an additional 100 games (`START_INDEX=100`). These use 50 distinct mirrored openings, none shared with the first 100-game confirmation. The native and ARMX source hashes match the published build. Together the two sets give **95W-87L-18D / 200**, or **47.5% actual wins**. This supports the diagnosis that the 65% contribution target remains unmet; the earlier 47-win result was not sufficient release evidence. Complete holdout games and source fingerprints are in `benchmarks/v5_5/armx-calibrated-holdout-100.json.gz`.

An archive of 21 rejected ARMX variants covers 1,020 games. It includes opponent-choice prediction, reply-outcome learning, threat context, recent-history weighting, repetition notes, evidence ablations, and voting limits. Always reviewing three candidates, selecting among eligible candidates, and repetition avoidance each scored **46 wins / 100**, below the calibration's 47 on the same openings. The other variants failed the 40-game development screen. Those screens deliberately reuse development openings and must not be represented as independent confirmation. Some strength screens ran concurrently; their timings are not speed evidence.

`benchmarks/v5_5/armx-rejected-experiments.json.gz` preserves hypotheses, results by game, configurations, loaded-source hashes, and the exact experimental sources. These sources are archived data, not active engine code. No rejected variant was promoted, no native engine or Pro source changed, and no release was made. The previous 4.702x direct-game speed measurement remains the applicable measurement for the unchanged build.

### Previous 40-game checkpoint

Forty games per matchup, twenty distinct openings with color swaps:

| Matchup | Wins | Losses | Draws | Speed vs Pro |
|---|---:|---:|---:|---:|
| 5.5 No ARMX vs Pro | 37 | 3 | 0 | 4.602x |
| 5.5 ARMX vs Pro | 37 | 2 | 1 | 4.272x |
| 5.5 ARMX vs No ARMX | 17 | 17 | 6 | — |

The prior native host scored 18W–16L–6D against Pro on these same forty games. This is a substantial native strength improvement, but the ARMX contribution gate is not met and this is not 100-game release proof. The saved forty-game source precedes the capture-only move-generation optimization; the optimized generator has exact legal capture/promotion parity on 1,002 positions, including promotion and en passant fixtures. A new 100-game confirmation is required for the final integrated source.

Evidence: 'benchmarks/v5_5/native-pvs-40.json' and its archived native source. No release or blog post was made.
