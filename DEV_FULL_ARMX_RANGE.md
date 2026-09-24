# Full ARMX range: active development checkpoint

The active draft is PR #133, `dev/full-armx-v55-range`. The frozen current v5.5 comparison is retained verbatim inside `models/models.js` and `ARMX/ARMX.js` and checked by source hashes in the range harness. The site loads the consolidated bundles; Dev Test exposes the three rolling best-known test units.

## Required outcomes

Each of Athena, Ares, and Artemis must score **strictly above 85%** over at least 100 color-balanced games against frozen current v5.5, with draws worth half. The six-pairing gate also includes every sibling matchup. Athena and Ares must achieve played-move ratios of 3x and 0.5x Artemis (±25%), respectively, maintain the peer-relationship bounds, and keep Full ARMX attributed overhead at or below 2x Preview. These goals are not met; the models are not release-ready.

Artemis must match current v5.5 in every respect except Full ARMX. Athena and Ares share Artemis's Full ARMX machinery and differ only in numeric playstyle values. Experimental branches have been reverted unless explicitly recorded here.

## Preserved findings

- Corrected Full-only response attribution: an opponent move's effect is measured at the position after that move; our move's effect is measured from the position after our move through the opponent reply. Preview and the shared evaluator remain unchanged. Direct e2e4/e7e5 attribution fixtures cover all Full-only effect tables.
- On two corrected 20-game sets combined (40 games per pairing), Athena scored 43.75%, Ares 46.25%, and Artemis 47.5% against current v5.5. Sibling scores were near even. Pace ratios were only 1.045x Athena and 0.990x Ares. Attributed overhead stayed below 1.4x Preview.
- Earlier finalist-weight and eligibility changes did not reliably alter pace or improve strength. A stronger repetition/forcing profile made Ares games longer (1.182x Artemis), the opposite of its target. These experiments were reverted.
- Reducing `fullNoteScale` from 320 to 80 looked promising in isolated Artemis samples but failed the full six-pairing screen: Athena 40%, Ares 42.5%, Artemis 45% vs current; pace 0.990x/1.045x. Setting it to 20 also failed and approached the overhead cap. A zero-scale boundary test scored better in one short sample, but removes the required Full-only learned vote and is not a valid candidate. The committed value remains 320.
- Full-ARMX decomposition implicated finalist review in a weak small-sample result; neither policy nor search budget alone explained it. These small, paired diagnostic samples are hypothesis evidence only, not release evidence.
- A probability-calibration diagnostic removed one redundant choice-probability factor from Full-only global and contextual response-outcome estimates. Across two separate 20-game six-pairing sets, combined current-v5.5 scores were Athena 42.5%, Ares 48.75%, Artemis 50.0%, compared with the corrected baseline's 43.75%, 46.25%, and 47.5%. The gain for Ares/Artemis came with an Athena regression, weak sibling balance, and combined played-move ratios around 0.92x for both Athena and Ares; overhead remained below 1.41x Preview. This mixed diagnostic was reverted and not promoted to any testunit.
- A separate reply-ordering diagnostic enabled a small learned Full-only policy delta (`policyWeightDeltaScale=0.35`, priority scale 70, maturity-scaled evidence). On one 20-game opening set, Athena/Ares/Artemis scored 45%/47.5%/45% against current v5.5; sibling scores were Ares 52.5% over Athena, Artemis 55% over Athena, and Artemis 62.5% over Ares. Pace ratios were 0.87x/0.96x and overhead stayed below 1.4x Preview. The sample does not isolate a strength improvement and worsens peer/style identity; the change was reverted.
- The structural range contract checks that policy, reply priorities/reductions, native search nodes/depth, and ordered exact root scores are identical before numeric finalist scoring across all three models. The compiled v5.5 contract covers 5,524 positions, 2,080 identities, and 128 complete searches. Attribution, reset, and reply-policy contracts are retained.

## Test units and promotion rule

`v5.5 Athena (testunit)`, `v5.5 Ares (testunit)`, and `v5.5 Artemis (testunit)` in Dev Test are rolling aliases for the saved best-known candidate of each profile. Whenever a candidate is demonstrably better and promoted, update these registrations and this checkpoint with its settings and evidence. Current test units are available for comparison; they do not pass the strength or pace gates.

## Active verification

Use `node benchmark_v5_5_range.js` for the six-pairing screen, `node benchmark_v5_5_armx_decomposition.js` for the diagnostic decomposition, and the retained kernel/ARMX contract scripts for regressions. CI runs these checks. Raw archived result bundles were intentionally removed during repository cleanup; the reproducible harnesses and concise findings above remain.
