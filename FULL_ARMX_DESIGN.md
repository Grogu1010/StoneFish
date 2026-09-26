# Full ARMX design

Full ARMX is **ARMX Preview taken further**. It is not a second chess evaluator and it does not get generic strength for free.

## Identity

Full ARMX:
- resets every game;
- learns only from moves, legal alternatives, contexts, predictions and outcomes observed in that game;
- models what this opponent chooses **when a behavior was actually available**;
- separately models what tends to work for the opponent and what tends to work for us against this opponent;
- estimates whether an outcome was plausibly caused by a behavior instead of merely occurring after it;
- falls back toward ARMX Preview/native v5.5 whenever opponent-specific evidence is weak or prediction quality is poor.

Full ARMX does **not**:
- add unconditional nodes, depth, positional bonuses or conversion heuristics;
- assume any chess behavior is good or bad before this opponent supplies evidence;
- treat multiple labels on one move as independent observations;
- treat predictability itself as value.

## Rich notebook

Preview is the base. Full tracks at least four times Preview's feature resolution, including:
- piece moved and piece captured;
- favorable/equal/unfavorable captures;
- checking captures, quiet checks and king-pressure moves;
- rook/queen/minor trades separately;
- central, kingside and queenside pawn play;
- development, repeated-piece movement, centralization and retreats;
- castling side;
- phase, queen state, material state, evaluation band, check state and board-side context;
- selected feature pairs for common interactions.

Global and context-specific statistics remain separate so evidence can back off gracefully when a precise context is sparse.

## Preference, effect and causal confidence

Every behavior keeps three concepts separate:

1. **Preference** — P(opponent chooses this | it was available, context).
2. **Effect** — the observed evaluation trajectory after it happened.
3. **Causal confidence** — evidence that the feature itself mattered rather than merely co-occurring with the result.

High preference improves prediction. It does not by itself make a move good or bad.

## Treatment vs control

For each available feature:
- **treatment** = feature was available and chosen;
- **control** = feature was available but declined.

Causal effect is based on the difference between treatment and control outcomes in comparable contexts, with shrinkage toward zero when evidence is sparse.

This is the main protection against false conclusions such as “the rook trade caused the collapse” when the position was already collapsing.

## Expected vs observed trajectory

Each event records the pre-event position and an expected local trajectory from the alternatives that were actually available. Outcomes are evaluated on multiple horizons.

The learned residual is conceptually:

`observed trajectory - expected trajectory`

rather than merely “evaluation after the move minus evaluation before it”.

## Correlated-feature credit

A move can be capture + trade + rookTrade + simplify at the same time. Those labels do not each receive full credit.

Specific child features receive most of the attribution. Broad parent labels are discounted when a more specific explanation is present. Confidence counts unique move observations, not labels or horizon samples.

## Contamination

Longer-horizon credit decays when a large unrelated event intervenes, such as a queen loss, promotion, major material shock or distinct forcing sequence. Immediate evidence remains, but later evidence loses causal weight as competing explanations appear.

## Prediction quality

Before each voluntary opponent move, Full scores the legal replies using only information available **before** seeing the move.

Track prediction quality from the probability/rank assigned to the actual reply. Full's influence is calibrated by that quality:
- accurate opponent model -> more trust;
- inaccurate opponent model -> shrink toward Preview/native behavior.

## Candidate-specific exploitation

For each candidate move:
1. generate the opponent replies;
2. estimate which replies this opponent is likely to choose in the resulting context;
3. combine reply probability with learned causal outcome;
4. combine that with causal evidence for what our own candidate type has done against this opponent;
5. apply a bounded adjustment only when evidence and causal confidence justify it.

The intended quantity is approximately:

`opponent likelihood × opponent-specific causal effect × confidence × context similarity`

not a generic chess bonus.

## Development gates

Before strength promotion, Full must demonstrate:
- clean per-game reset and side isolation;
- no opening evidence leakage;
- treatment/control opportunity correctness;
- unique-observation confidence;
- no future information in predictions;
- causal effect shrinks toward zero without matched controls;
- correlated labels do not manufacture confidence;
- prediction metrics improve over Preview on the same games;
- no unconditional base-engine/search advantage.

Then Artemis is the neutral strength benchmark against frozen v5.5. Athena and Ares are tuned only after the shared Full ARMX is strong.
