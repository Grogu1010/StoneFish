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

Forty games per matchup, twenty distinct openings with color swaps:

| Matchup | Wins | Losses | Draws | Speed vs Pro |
|---|---:|---:|---:|---:|
| 5.5 No ARMX vs Pro | 37 | 3 | 0 | 4.602x |
| 5.5 ARMX vs Pro | 37 | 2 | 1 | 4.272x |
| 5.5 ARMX vs No ARMX | 17 | 17 | 6 | — |

The prior native host scored 18W–16L–6D against Pro on these same forty games. This is a substantial native strength improvement, but the ARMX contribution gate is not met and this is not 100-game release proof. The saved forty-game source precedes the capture-only move-generation optimization; the optimized generator has exact legal capture/promotion parity on 1,002 positions, including promotion and en passant fixtures. A new 100-game confirmation is required for the final integrated source.

Evidence: 'benchmarks/v5_5/native-pvs-40.json' and its archived native source. No release or blog post was made.
