// Stonefish v5 Pro root-fusion optimization.
//
// This does not change the root knowledge formula. It evaluates the same v5 +
// Pro terms from one applied child position and one opponent legal-move list,
// instead of repeatedly applying the root move for inverse mobility, check risk,
// mate-pattern geometry, positional score, adaptive score and counterplay.

const stonefishV5ProRootFusionReferenceKnowledge = stonefishV5ProRootKnowledge;

function stonefishV5ProRootFusionStrictPatternAfterApplied(game, raw, ownSide, enemySide) {
  let score = 0;
  score += stonefishV45LadderScore(game, ownSide, enemySide);
  score += stonefishV45TriangleScore(game, ownSide, enemySide);
  score += stonefishV45BackRankScore(game, ownSide, enemySide);
  score += stonefishV45SmotheredScore(game, ownSide, enemySide, raw);
  score += stonefishV45ArabianScore(game, ownSide, enemySide);
  score += stonefishV45BodenScore(game, ownSide, enemySide);

  const freedom = stonefishV4KingFreedom(game, enemySide);
  if (
    game.in_check() &&
    freedom === 0 &&
    stonefishV45Pieces(game, ownSide, 5).length &&
    stonefishV45Pieces(game, ownSide, 4).length
  ) {
    score += 24;
  }
  return score;
}

function stonefishV5ProRootFusionCounterplay(replies, checks, game, c) {
  let promotions = 0;
  let heavyCaptures = 0;
  let forcing = 0;
  for (let i = 0; i < replies.length; i += 1) {
    const move = replies[i];
    if (move.promotion) promotions += 1;
    if ((STONEFISH_V5_PIECE[move.captured] || 0) >= 320) heavyCaptures += 1;
    if (move.captured || move.promotion) forcing += 1;
  }

  const enemyPasser = stonefishV5ProRecoveryNearestPasser(c.theirPassers);
  const passerDanger = enemyPasser <= 1 ? 1100 : enemyPasser === 2 ? 420 : enemyPasser === 3 ? 150 : 0;
  return checks * 95
    + promotions * 620
    + heavyCaptures * 75
    + forcing * 7
    + replies.length * 2
    + passerDanger;
}

stonefishV5ProRootKnowledge = function(game, raw, heritageMove, bookMove, perspective, tactical) {
  let points = 0;
  const heritageMatch = heritageMove && stonefishV5SameMove(raw, heritageMove);

  if (bookMove && stonefishV5SameMove(raw, bookMove)) points += STONEFISH_V5_WEIGHTS.book;
  if (raw.flags & (4 | 8)) points += STONEFISH_V5_WEIGHTS.castle;
  if (raw.promotion) points += STONEFISH_V5_WEIGHTS.promotion;

  game.fastApply(raw);
  const ownSide = -game.side;
  const enemySide = game.side;
  const givesCheck = game.in_check();
  if (givesCheck) points += STONEFISH_V5_WEIGHTS.check;

  const replies = game.fastMoves();
  let checks = 0;
  for (let i = 0; i < replies.length; i += 1) {
    if (game.fastGivesCheck(replies[i])) checks += 1;
  }
  points += (-checks) * STONEFISH_V5_WEIGHTS.oppCheckRisk;
  points += (-replies.length) * STONEFISH_V5_WEIGHTS.oppMobility;
  points += stonefishV5ProRootFusionStrictPatternAfterApplied(
    game, raw, ownSide, enemySide
  ) * STONEFISH_V5_WEIGHTS.matePattern;

  points += stonefishV5PositionScore(game, perspective) * STONEFISH_V5_WEIGHTS.positional;

  const visits = game.positionCounts.get(game.fastPositionKey()) || 0;
  const c = stonefishV5ProContexts(game, perspective);
  if (visits > 0) {
    points -= visits * STONEFISH_V5_WEIGHTS.repetition;
    if (c.lead >= 200) points -= STONEFISH_V5_WEIGHTS.repetitionAhead;
  }
  if (game.halfmove >= 60 && (raw.piece === 1 || raw.captured)) {
    points += STONEFISH_V5_WEIGHTS.fiftyReset;
  }

  const adaptive = stonefishV5ProAdaptivePosition(game, perspective);
  const counterplay = stonefishV5ProRootFusionCounterplay(replies, checks, game, c);
  const enemyThreat = stonefishV5ProRecoveryPasserDanger(c.theirPassers);

  points += adaptive * 0.72;
  points -= counterplay * (0.72 + c.defence * 0.65 + c.conversion * 0.45);

  if (heritageMatch) {
    const threatScale = enemyThreat >= 300 ? 0.04 : enemyThreat >= 120 ? 0.18 : enemyThreat >= 35 ? 0.48 : 1;
    const noveltyScale = 0.32 + c.phase * 0.68;
    points += STONEFISH_V5_WEIGHTS.heritage * threatScale * noveltyScale;
  }

  let agreement = 0;
  if (tactical > 25) agreement += 1;
  if (adaptive > 80) agreement += 1;
  if (heritageMatch) agreement += 1;
  if (givesCheck || raw.captured || raw.promotion) agreement += 1;
  if (agreement >= 3) points += 120 + agreement * 25;
  else if (tactical < -120 && adaptive > 120) points -= 160;

  if (visits > 0 && c.lead > 100) points -= 220000;
  if (c.conversion > 0 && raw.captured) {
    points += (STONEFISH_V5_PIECE[raw.captured] || 0) * (0.35 + 0.45 * c.conversion);
  }

  game.fastUndo();
  return points;
};
