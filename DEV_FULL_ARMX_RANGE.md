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

## Follow-up decomposition and note-scale diagnostics

The developer-only 20-game Artemis decomposition compared each component to
current v5.5 on the same paired openings:

| Candidate | W-L-D vs current v5.5 |
| --- | ---: |
| Full ARMX policy + Full finalist review | 6-13-1 |
| Full ARMX policy + Preview finalist review | 10-10-0 |
| Preview policy + Full finalist review | 6-13-1 |
| Full budget + Preview ordering/review | 10-10-0 |
| Preview budget + Full ordering + Preview review | 10-10-0 |

This implicates the Full finalist review in this sample; the policy and search
budget alone did not account for its weaker result. These games use the
decomposition harness and should be compared within that harness, not merged
with the range benchmark totals above.

On the range benchmark's first 20 Artemis-vs-current games, disabling the
Full-only notebook adjustment (`fullNoteScale=0`) scored 10-7-3; reducing it
from 320 to 80 scored 11-6-3, versus 7-12-1 at 320. On a separate 20-game
opening set (`START_INDEX=20`), the 80-scale candidate scored 7-11-2 versus
4-14-2 at 320. Full notes therefore have a useful signal, but their current
weight appears too high on both small samples. The zero-scale diagnostic is
not an acceptable Full ARMX release because it removes Full notes' vote.

The 80-scale candidate was **not promoted**. In the complete first-set
six-matchup screen, Artemis improved to 11-6-3 against current v5.5, but
Athena fell to 8-11-1 and Ares-vs-Athena to 7-11-2. Artemis's score against
current v5.5 was 62.5%, still below its 80% floor. Athena's game-length ratio
was 1.057x and Ares's 0.903x, still far from 3x and 0.5x. Thus the candidate
did not satisfy the peer-strength or style-identity requirements.

Two further single-matchup screens were rejected: allowing only positive
Full-note leads retained the baseline 7-12-1; limiting Full review to two
finalists scored 8-12-0. Adding up to 2,000 note-earned search nodes to the
80-scale candidate scored 8-7-5 and raised Artemis's attributed overhead to
1.662x Preview, worse than 11-6-3 without extra nodes. All used 20 games on
the first opening set. No behavioral experiment in this section was promoted.
