# Full ARMX range: September 23 diagnostic checkpoint

The active draft is PR #133 (`dev/full-armx-v55-range`). Current v5.5 on `main`
is the frozen comparison. Artemis uses that same native v5.5 host with Full ARMX
in place of ARMX Preview. Athena and Ares use the same Full ARMX policy and
host, with only numeric finalist-style profiles changed. No range model is
ready for the public opponent selector.

## Release gates

Each model must score **above 85%** in its own 100-game, color-balanced pairing
against current v5.5, with draws worth half a point. The existing six-pairing
range gate runs 100 games for each of Athena/current, Ares/current,
Artemis/current, and all three sibling pairs. In addition, Athena and Ares must
meet the defensive/aggressive pace targets of 3x and 0.5x Artemis respectively
(±25%), peer-relationship bounds, and attributed Full ARMX overhead no greater
than 2x Preview. All thresholds apply together. Earlier tables in this note are
diagnostics under the previous score floors and do not qualify as release proof.

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

## Response attribution correction: September 24

Full's old outcome notebook mixed the score change from our initiating move
with the opponent's reply. Full-only effects now attribute an opponent move at
the position immediately after that move. When learning how the opponent
handled one of our moves, the baseline is the position immediately after our
move, and the outcome is measured after their reply. This leaves ARMX Preview
and the shared v5.5 evaluator untouched. The range benchmark now has a direct
e2e4/e7e5 attribution contract for all three Full-only effect tables.

Two color-balanced 20-game sets (40 games per pairing, 20 distinct openings)
produced:

| Pairing | Combined W-L-D | Score |
| --- | ---: | ---: |
| Athena vs current v5.5 | 13-18-9 | 43.75% |
| Ares vs current v5.5 | 15-18-7 | 46.25% |
| Artemis vs current v5.5 | 16-18-6 | 47.50% |
| Ares vs Athena | 18-17-5 | 51.25% |
| Artemis vs Athena | 19-19-2 | 50.00% |
| Artemis vs Ares | 16-18-6 | 47.50% |

The average played moves per game against current v5.5 were 56.0 Athena,
53.05 Ares, and 53.6 Artemis. That gives pace ratios of **1.045x** and
**0.990x**, still far from the requested 3x and 0.5x. The sibling score and
identity gates also remain unmet. Attributed overhead was below 1.4x Preview
for every model in each set, within the 2x cap.

Compared with the first 20-game set before this correction, Artemis improved
from 7-12-1 to 7-9-4 against current v5.5; sibling results shifted closer to
even. On the second set, Artemis improved from 4-14-2 to 9-9-2. Athena and
Ares lost more often to current v5.5 in the combined corrected results. These
40-game totals are diagnostics, not release evidence.

The corrected result records, source hashes, and per-game records are archived
in `response-attributed-range-20-2026-09-24.json.gz` and
`response-attributed-holdout-range-20-2026-09-24.json.gz`. The range
benchmark, reset contract, reply-policy contract, and compiled-kernel contract
pass with the correction. Keep the change on the draft for further work; no
release gate is satisfied yet.

## Numeric finalist-style profile screens: September 24

The style-only constraint remains in force: all three engines use the same
Full policy, reply priority, reductions, and native search behavior; Athena and
Ares vary only numeric style-profile values. The moderate-profile screen
(minimum style lead 2; Athena host-gap/deep limits 32/20; Ares 24/16) produced
Athena 7-11-2, Ares 8-10-2, and Artemis 7-9-4 against current v5.5, with 54.3,
55.9, and 56.2 average played moves respectively. These first-set ratios were
0.965x Athena and 0.994x Ares. Overhead was 1.41x, 1.39x, and 1.34x Preview.

An intentionally extreme numeric-only screen (minimum style lead 0, broader
score/deep eligibility, and larger style weights) produced Athena 7-12-1,
Ares 9-10-1, and Artemis 7-9-4 against current v5.5. Sibling results were
Ares 11-8-1 vs Athena, Artemis 14-6-0 vs Athena, and Artemis 9-10-1 vs Ares.
Average played moves were 51.8 Athena, 66.4 Ares, and 56.2 Artemis, or 0.921x
and 1.182x: making Ares more aggressive by score weighting actually lengthened
its games in this sample. Changed-move rates were 0.40 Athena and 0.33 Ares.
Overhead remained within the cap at 1.39x, 1.36x, and 1.28x Preview.

Neither screen meets strength or identity gates. The compressed per-game records
are `numeric-style-experiment-20-2026-09-24.json.gz` and
`extreme-style-experiment-20-2026-09-24.json.gz`. These reject simple finalist
weight/eligibility scaling as a sufficient style control; the next adjustment
needs to target measurable behavior that changes game pace, while retaining
identical Artemis and v5.5 behavior outside Full ARMX.

## Pace-control profile screen: September 24

A second numeric-only experiment changed Athena's repetition/survival weights
and opponent-tendency response, and made Ares favor forcing/capture features
and avoid repetition more strongly. Shared search and Full policy were held
fixed, and Artemis remained the zero-style baseline. The 20-game first-set
screen produced:

| Pairing | W-L-D | Score | Played moves/game |
| --- | ---: | ---: | ---: |
| Athena vs current v5.5 | 8-10-2 | 45.0% | 44.35 |
| Ares vs current v5.5 | 8-11-1 | 42.5% | 55.15 |
| Artemis vs current v5.5 | 7-9-4 | 45.0% | 56.23 |
| Ares vs Athena | 9-10-1 | 47.5% | 48.98 |
| Artemis vs Athena | 10-9-1 | 52.5% | 61.08 |
| Artemis vs Ares | 14-5-1 | 72.5% | 52.75 |

Athena's ratio fell to **0.789x** Artemis, farther from its 3x target. Ares
remained at **0.981x**, far from 0.5x, and current-v5.5 strength and sibling
identity gates failed. Attributed overhead remained under 1.4x Preview. The
archive is `pace-control-style-screen-20-2026-09-24.json.gz`; it stores the
complete records and exact candidate profile. The candidate was not promoted.
This screen reinforces that isolated repetition/tactical weights do not control
pace reliably, and can create a large Artemis-over-Ares sibling edge.

## Reduced Full-note scale confirmation: September 24

The earlier one-matchup screens suggested reducing `fullNoteScale` from 320 to
80 could improve Artemis. With response attribution corrected and Athena/Ares
back on their committed profiles, a complete 20-game six-pairing screen at 80
did not confirm that result:

| Pairing | W-L-D | Score | Played moves/game |
| --- | ---: | ---: | ---: |
| Athena vs current v5.5 | 7-11-2 | 40.0% | 52.22 |
| Ares vs current v5.5 | 7-10-3 | 42.5% | 55.18 |
| Artemis vs current v5.5 | 7-9-4 | 45.0% | 52.78 |
| Ares vs Athena | 6-13-1 | 32.5% | 47.48 |
| Artemis vs Athena | 8-10-2 | 45.0% | 45.45 |
| Artemis vs Ares | 8-12-0 | 40.0% | 45.20 |

Pace ratios were **0.990x** Athena and **1.045x** Ares. Attributed overhead
was 1.40x, 1.35x, and 1.25x Preview (Athena/Ares/Artemis), but all strength,
pace, and sibling-identity goals failed. The full records and exact profile are
in `note-scale-80-screen-20-2026-09-24.json.gz`. Keep the 320 baseline; the
prior small Artemis-only gains at 80 did not generalize to the full range.

## Zero Full-note vote diagnostic: September 24

As a boundary diagnostic only, setting `fullNoteScale` to zero removes the
Full-only learned-outcome vote while retaining the Full policy, response
collection, and numeric Athena/Ares style scoring. On the same 20-game first
opening set, this scored 10-8-2 Athena, 9-8-3 Ares, and 10-7-3 Artemis against
current v5.5 (55%, 52.5%, and 57.5%). Sibling field scores were tightly grouped
at 51.7% Athena, 50.8% Ares, and 52.5% Artemis. Average played moves were 53.78,
53.30, and 54.15; ratios 0.993x Athena and 0.984x Ares. Attributed overhead
was 1.27x, 1.19x, and 1.12x Preview.

This suggests Full-only outcome voting may be reducing strength, but zero
removes a required Full ARMX capability and barely changes style identity.
It is not a viable release setting. Records and exact zero-scale configuration
are archived in `note-scale-zero-screen-20-2026-09-24.json.gz`. A low, nonzero
scale is the remaining useful check of this hypothesis.

## Low nonzero Full-note scale screen: September 24

The full range was screened at `fullNoteScale=20` to retain a Full-only learned
vote while staying near the zero-vote diagnostic. The first 20-game set gave
Athena 9-8-3 (52.5%), Ares 8-8-4 (50%), and Artemis 7-11-2 (40%) against
current v5.5. Sibling field scores were 51.7% Athena, 50% Ares, and 45.8%
Artemis. Average played moves were 59.02, 54.32, and 52.18, for ratios of
**1.131x** Athena and **1.041x** Ares. Attributed overhead was **1.47x**,
**1.39x**, and **1.30x** Preview, respectively.

This failed strength, pace, and sibling gates, and raised Athena's overhead
closer to the 2x limit. It shows that low note scale is not a reliable smooth
compromise between zero and the committed 320. Archive:
`note-scale-20-screen-20-2026-09-24.json.gz`. Do not promote.
