# Full ARMX range: September 23 diagnostic checkpoint

The active draft is PR #133 (`dev/full-armx-v55-range`). Current v5.5 on `main`
is the frozen comparison. Artemis uses that same native v5.5 host with Full ARMX
in place of ARMX Preview. Athena and Ares use the same Full ARMX policy and
host, with only numeric finalist-style profiles changed. No range model is
ready for the public opponent selector.

## Controlled 20-game diagnostic

`GAMES=20 node benchmark_v5_5_range.js` ran all six pairings from start index
zero. Each pairing used ten generated openings with colors swapped. Node was
v24.19.0 on Windows. The full result, including per-game records and loaded
source hashes, is in
`benchmarks/v5_5/full-armx-range-20-2026-09-23.json.gz`.

| Pairing | W-L-D | Score | Played moves/game |
| --- | ---: | ---: | ---: |
| Athena vs current v5.5 | 10-10-0 | 50.0% | 53.0 |
| Ares vs current v5.5 | 11-8-1 | 57.5% | 47.2 |
| Artemis vs current v5.5 | 7-12-1 | 37.5% | 55.4 |
| Ares vs Athena | 9-10-1 | 47.5% | 54.2 |
| Artemis vs Athena | 7-12-1 | 37.5% | 56.2 |
| Artemis vs Ares | 5-11-4 | 35.0% | 58.4 |

Athena's played-move ratio to Artemis against current v5.5 was **0.956x**;
Ares's was **0.853x**. The requested centers are 3x and 0.5x, with 25%
tolerance. Full ARMX attributed overhead relative to ARMX Preview was 1.396x
for Athena, 1.324x for Ares, and 1.231x for Artemis, below the 2x limit in
this diagnostic. This sample is too small to establish strength, speed, or
release qualification; the release gate requires 100 color-balanced games for
every pairing.

## Experiments rejected on the same eight-game opening set

- Adding mild opening/equal-position style weights and widening Athena/Ares
  style eligibility increased their changed-move rates, but Athena's games
  shortened from 48.4 to 45.5 played moves and Ares-vs-Athena moved from
  4W-4L to 3W-4L-1D. The candidate was reverted.
- Scanning every opponent choice instead of every second choice raised Full
  ARMX attributed overhead to 1.56x/1.51x/1.41x (Athena/Ares/Artemis) and
  did not move game lengths toward their targets. The candidate was reverted.

Those eight-game screens are directional diagnostics, not independent strength
evidence. Neither experiment was promoted.

## Architecture guard

`benchmark_v5_5_range.js` now compares four varied positions across all three
range models. Before finalist style scoring, policy fields, reply priorities,
reply reductions, native-search nodes/depth, and ordered exact root scores must
match. In `ARMX.js`, style-specific reply analysis and finalist voting now turn
on from numeric profile values; there is no special Artemis name branch.
The change preserved all six eight-game outcomes and played-ply counts exactly.
The kernel contract passed 5,524 positions and 128 full searches; the ARMX
reset and reply-policy contracts passed.

The largest measured gaps are Full ARMX's strength against current v5.5 and
the requested game-length identities. Optimize or revise a hypothesis against
the archived results before increasing style overrides or search cost.
