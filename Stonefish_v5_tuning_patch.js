// Stonefish_v5 tuning pass 3.
// Keep the proven v5(testunit1) choice as a strong prior while the new all-move
// scorecard is tuned. Repetition is treated as a near-terminal conversion error.
STONEFISH_V5_WEIGHTS.heritage = 1500;
STONEFISH_V5_WEIGHTS.repetition = 200000;
STONEFISH_V5_WEIGHTS.repetitionAhead = 300000;

// The previous pass showed a remaining draw where v4.5 completed the threefold
// on its own reply. Penalise a v5 move if ANY immediate opponent reply can enter
// a position that has already occurred twice. This looks one ply ahead for the
// draw mechanism rather than waiting until v5 itself is the repeating side.
const stonefishV5TacticalScoreBeforeRepeatGuard = stonefishV5TacticalScore;
stonefishV5TacticalScore = function(game, raw) {
  let score = stonefishV5TacticalScoreBeforeRepeatGuard(game, raw);
  if (Math.abs(score) >= STONEFISH_V5_MATE) return score;

  game.fastApply(raw);
  const replies = game.fastMoves();
  let opponentCanClaimThreefold = false;
  for (let i = 0; i < replies.length; i += 1) {
    game.fastApply(replies[i]);
    const priorVisits = game.positionCounts.get(game.fastPositionKey()) || 0;
    game.fastUndo();
    if (priorVisits >= 2) {
      opponentCanClaimThreefold = true;
      break;
    }
  }
  game.fastUndo();

  if (opponentCanClaimThreefold) score -= 1000000;
  return score;
};
