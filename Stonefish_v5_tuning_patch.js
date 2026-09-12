// Stonefish_v5 tuning pass 5.
// The former prototype's useful move preference is now internal to v5 itself.
// Repetition is treated as a near-terminal conversion error because a winning
// engine should choose a new route rather than recycle a mating threat forever.
STONEFISH_V5_WEIGHTS.heritage = 1500;
STONEFISH_V5_WEIGHTS.repetition = 200000;
STONEFISH_V5_WEIGHTS.repetitionAhead = 300000;

const stonefishV5TacticalScoreBase = stonefishV5TacticalScore;

stonefishV5TacticalScore = function(game, raw) {
  // Deliver mate immediately whenever it exists.
  if (game.fastIsMateMove(raw)) return STONEFISH_V5_MATE * 2;

  let score = stonefishV5TacticalScoreBase(game, raw);

  // A one-move mating threat is enormously valuable, but it is not checkmate.
  // Keep it below the terminal band so conversion rules can still break loops.
  if (score >= STONEFISH_V5_MATE) score = STONEFISH_V5_MATE * 0.5;
  if (score <= -STONEFISH_V5_MATE) return score;

  game.fastApply(raw);

  // fastApply does not alter positionCounts, so any existing count here means
  // this candidate returns to a position that occurred in the real game.
  const rootVisits = game.positionCounts.get(game.fastPositionKey()) || 0;
  if (rootVisits > 0) score -= rootVisits * STONEFISH_V5_MATE * 2;

  // Likewise, if one legal opponent reply reaches a position already seen twice,
  // this root move allows an immediate threefold. Treat that as a conversion fail.
  const replies = game.fastMoves();
  for (let i = 0; i < replies.length; i += 1) {
    game.fastApply(replies[i]);
    const priorVisits = game.positionCounts.get(game.fastPositionKey()) || 0;
    game.fastUndo();
    if (priorVisits >= 2) {
      score -= STONEFISH_V5_MATE * 2;
      break;
    }
  }

  game.fastUndo();
  return score;
};
