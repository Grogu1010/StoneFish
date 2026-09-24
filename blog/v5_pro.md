# Introducing Stonefish v5 Pro

Stonefish v5 Pro is not a small extension of v5. It is the moment Stonefish takes the unified points architecture and gives it something it has never had before: **context, threat awareness, and deeper search working together**.

Stonefish v5 proved that every legal move could be judged on one scoreboard. Stonefish v5 Pro keeps that architecture, then adds adaptive weights, richer tactical geometry, counterplay suppression, confidence-aware scoring, and a selective five-ply alpha-beta search.

The result is the strangest benchmark Stonefish has produced yet — and one of the most revealing.

## The Pro idea: the same scorecard, but context changes the weights

Stonefish v5 uses a unified points system. Stonefish v5 Pro keeps that idea, but stops treating every phase of the game the same way.

The engine now estimates context: opening, attack, defence, conversion, endgame, and pawn-race conditions. Those contexts change what matters most.

Development matters more when the opening is still alive. King safety grows in importance under attack. King activity becomes more valuable in the endgame. Passed pawns become dramatically more important in pawn races. When Stonefish is ahead, counterplay suppression and clean conversion receive extra emphasis.

The point system is no longer just unified. It is adaptive.

## Threat geometry becomes explicit

Stonefish v5 Pro adds tactical and positional concepts that v5 did not score as directly.

It measures loose pieces and coordination, attacker-versus-defender counts, king-zone pressure, ray tactics such as pins and skewers, overloaded or under-defended pieces, enemy checking chances, forcing moves, promotion threats, and dangerous passed pawns.

That means the engine can recognize that two positions with similar material and mobility are not actually equally safe.

A move that looks good on a static score can lose value if it gives the opponent too much forcing counterplay. A quieter move can become better if it shuts that counterplay down.

## Confidence matters

Pro also looks for agreement between independent signals.

If the tactical score is positive, the adaptive positional score is strong, the heritage system agrees, and the move is forcing, Stonefish gains confidence in the move.

But if the positional picture looks attractive while the tactical score is warning against it, Pro can actively distrust the pretty position.

That is an important step beyond simply adding more features. The engine is beginning to ask whether its own systems agree.

## The biggest mechanical change: five-ply search

Stonefish v5's tactical horizon is three plies. Stonefish v5 Pro adds exactly two more searched plies.

It first gives every legal move a preliminary v5-style score. Then it keeps the top eight candidates and searches those lines out to five plies with alpha-beta pruning.

That deeper score is blended back with the preliminary score, with mating results allowed to dominate outright.

The search is selective rather than exhaustive, but it changes what Stonefish can verify before committing.

A move that looks best after three plies can now be challenged by what happens two moves later.

## The test: 2,000 direct games

For the v5 Pro benchmark, only games involving Stonefish v5 Pro count: 1,000 against Stonefish v4.5 and 1,000 against Stonefish v5.

Across those 2,000 games, Stonefish v5 Pro scored:

**1,500 wins · 500 losses · 0 draws**

That is a **75.0% win rate**.

But the aggregate hides the real story.

### v5 Pro vs v5: 1000–0

Against Stonefish v5, Pro was perfect.

- Stonefish v5 Pro: **1,000 wins, 0 losses, 0 draws**
- Stonefish v5: **0 wins, 1,000 losses, 0 draws**
- Stonefish v5 Pro win rate: **100.0%**

The model that had just gone 2,000–0 against v4 and v4.5 lost every game to Pro.

That is the clearest evidence for the value of the adaptive evaluation and deeper search. Pro keeps the same basic scoring philosophy, but it sees more context, more threats, and two additional plies before making the final decision.

## And then v4.5 goes 500–500

This is where the benchmark gets genuinely interesting.

Against Stonefish v4.5, Pro did not dominate.

- Stonefish v5 Pro: **500 wins, 500 losses, 0 draws**
- Stonefish v4.5: **500 wins, 500 losses, 0 draws**

That creates an extreme matchup triangle:

- v5 beats v4.5 **1000–0**.
- v5 Pro beats v5 **1000–0**.
- v5 Pro and v4.5 split **500–500**.

More search does not produce a perfectly transitive ladder.

## Why can Pro destroy v5 but only split with v4.5?

The code suggests several plausible reasons.

First, v5 and Pro speak almost exactly the same language. Pro inherits the v5 points architecture and then adds adaptive weighting, threat awareness, counterplay suppression, and five-ply verification. In that matchup, Pro is effectively taking v5's own decision framework and seeing farther through it.

v4.5 is structurally different. It is much more book-driven and lexicographic. Its decisions can emerge from opening preparation and staged positional filters rather than from the same unified score that Pro is designed to improve.

Second, Pro reintroduces **selectivity**. Every move gets a preliminary score, but only the top eight candidates are searched deeply. That is usually a strength, because the engine can spend its deeper search on serious moves. But it also means Pro has a different failure mode from v5: if an awkward v4.5 position pushes the truly resilient move outside the top-eight preliminary shortlist, the deeper search never gets to rescue it.

Third, v4.5's opening repertoire can steer games into prepared structures before Pro's deeper middlegame advantages fully take over. v5's unified scoring happened to destroy that system in the previous benchmark, but Pro's adaptive priorities and candidate shortlist can choose different continuations from v5 even when starting from the same position.

The exact **500–500 with zero draws** is especially striking. That kind of perfectly even split is consistent with a systematic color, opening-branch, or deterministic matchup effect. Without per-color or per-opening game logs, that cannot be claimed as the proven cause — but it is strong evidence that the result is not simply random noise.

What the benchmark proves is simpler and more important: **engine strength is matchup-dependent**.

Stonefish v5 Pro is overwhelmingly stronger than v5 head-to-head. Yet v4.5 exposes a completely different interaction that produces an even split.

## Deeper does not mean simpler

It would be easy to read Pro as “v5 plus two plies.” That misses most of the model.

The deeper search matters, but so do the adaptive weights around it. Pro changes priorities depending on the game state. It measures enemy counterplay. It notices tactical geometry. It adjusts trust in inherited Stonefish behavior when passed-pawn danger rises. It rewards agreement between systems and penalizes disagreement between tactical and positional signals.

It is a model built around the idea that evaluation should change with the position rather than remain fixed.

## From judgment to adaptation

Stonefish v1 was unpredictable.

Stonefish v2 became aware.

Stonefish v3 learned to calculate.

Stonefish v4 learned to build.

Stonefish v4.5 arrived prepared.

Stonefish v5 learned to judge.

**Stonefish v5 Pro learns to adapt — and then looks deeper before it commits.**

The result is not a perfectly ordered ladder. It is something more interesting: a stronger engine with a distinct matchup profile, capable of annihilating v5 while revealing that opening structure and opponent style can still completely reshape a head-to-head result.