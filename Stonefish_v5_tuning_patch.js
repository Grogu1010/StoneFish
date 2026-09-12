// Stonefish_v5 tuning pass 4.
// Keep the proven v5(testunit1) choice as a strong prior while the new all-move
// scorecard is tuned. Repetition is treated as a near-terminal conversion error.
STONEFISH_V5_WEIGHTS.heritage = 1500;
STONEFISH_V5_WEIGHTS.repetition = 200000;
STONEFISH_V5_WEIGHTS.repetitionAhead = 300000;

// Preserve the untuned three-ply tactical evaluator so this patch can add
// conversion rules without changing its material logic.
const stonefishV5TacticalScoreBase = stonefishV5TacticalScore;

stonefishV5TacticalScore = function(game, raw) {
  // Mate now must beat every "mate next move" setup. The old evaluator returned
  // the same mate constant for both, which allowed endless renewal of a mating
  // threat instead of delivering checkmate.
  if (game.fastIsMateMove(raw)) return STONEFISH_V5_MATE * 2;

  let score = stonefishV5TacticalScoreBase(game, raw);

  // A non-terminal move that creates a forced mate threat stays just below the
  // terminal band so positional/conversion points (especially repetition) still
  // participate in the final root score.
  if (score >= STONEFISH_V5_MATE) score = STONEFISH_V5_MATE - 1000;
  if (score <= -STONEFISH_V5_MATE) return score;

  game.fastApply(raw);

  // Penalise v5's own return to any previously visited position.
  const rootVisits = game.positionCounts.get(game.fastPositionKey()) || 0;
  if (rootVisits > 0) score -= rootVisits * 1000000;

  // Also avoid giving v4.5 an immediate reply that completes a threefold.
  const replies = game.fastMoves();
  for (let i = 0; i < replies.length; i += 1) {
    game.fastApply(replies[i]);
    const priorVisits = game.positionCounts.get(game.fastPositionKey()) || 0;
    game.fastUndo();
    if (priorVisits >= 2) {
      score -= 1000000;
      break;
    }
  }

  game.fastUndo();
  return score;
};
