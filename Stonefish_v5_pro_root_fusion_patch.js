// Stonefish v5 Pro root-fusion optimization.
//
// This keeps the same root and adaptive scoring formulas while sharing work:
// - one applied root child for inverse pressure, pattern geometry and counterplay,
// - one fused positional feature pass shared by v5 positional and Pro adaptive
//   scores instead of evaluating the same child position twice.

const stonefishV5ProRootFusionReferenceKnowledge = stonefishV5ProRootKnowledge;
const STONEFISH_V5_PRO_ROOT_FUSION_BASE_CACHE = new Map();

function stonefishV5ProRootFusionKey(game, perspective) {
  return perspective + '|' + game.fullmove + '|' + game.fastPositionKey();
}

// Same adaptive formula as the recovery layer, but retain the exact final-v5
// base score so root knowledge can consume it without a second position pass.
stonefishV5ProAdaptivePosition = function(game, perspective) {
  const key = stonefishV5ProRootFusionKey(game, perspective);
  const cached = STONEFISH_V5_PRO_RECOVERY_ADAPTIVE_CACHE.get(key);
  if (cached !== undefined) return cached;

  const enemy = -perspective;
  const c = stonefishV5ProContexts(game, perspective);
  const previousMemo = STONEFISH_V5_PRO_RECOVERY_ACTIVE_ATTACK_MEMO;
  STONEFISH_V5_PRO_RECOVERY_ACTIVE_ATTACK_MEMO = c.attackMemo;

  const ourMobility = game.fastMobility(perspective);
  const enemyMobility = game.fastMobility(enemy);
  const mobility = ourMobility - enemyMobility;
  const development = stonefishV4Development(game, perspective) - stonefishV4Development(game, enemy);
  const center = stonefishV4CenterControl(game, perspective) - stonefishV4CenterControl(game, enemy);
  const minorCentral = stonefishV4MinorCentralization(game, perspective) - stonefishV4MinorCentralization(game, enemy);
  const kingProtection = stonefishV4KingProtection(game, perspective) - stonefishV4KingProtection(game, enemy);
  const kingFreedom = stonefishV4KingFreedom(game, perspective) - stonefishV4KingFreedom(game, enemy);
  const pawnStructure = stonefishV4PawnStructure(game, perspective) - stonefishV4PawnStructure(game, enemy);
  const rookActivity = stonefishV4RookActivity(game, perspective) - stonefishV4RookActivity(game, enemy);
  const kingPlacement = stonefishV4KingPlacement(game, perspective) - stonefishV4KingPlacement(game, enemy);
  const boardControl = stonefishV4BoardControl(game, perspective) - stonefishV4BoardControl(game, enemy);
  const hanging = stonefishV4HangingMax(game, perspective) - stonefishV4HangingMax(game, enemy);
  const passers = stonefishV5ProRecoveryPassedScore(c.ourPassers)
    - stonefishV5ProRecoveryPassedScore(c.theirPassers);

  let baseScore = c.lead;
  baseScore += mobility * STONEFISH_V5_WEIGHTS.mobility;
  baseScore += development * STONEFISH_V5_WEIGHTS.development;
  baseScore += center * STONEFISH_V5_WEIGHTS.center;
  baseScore += minorCentral * STONEFISH_V5_WEIGHTS.minorCentral;
  baseScore += kingProtection * STONEFISH_V5_WEIGHTS.kingProtection;
  baseScore += kingFreedom * STONEFISH_V5_WEIGHTS.kingFreedom;
  baseScore += pawnStructure * STONEFISH_V5_WEIGHTS.pawnStructure;
  baseScore += rookActivity * STONEFISH_V5_WEIGHTS.rookActivity;
  baseScore += kingPlacement * STONEFISH_V5_WEIGHTS.kingPlacement;
  baseScore += boardControl * STONEFISH_V5_WEIGHTS.boardControl;
  baseScore += hanging * STONEFISH_V5_WEIGHTS.hanging;
  baseScore += c.bishopPairDiff * STONEFISH_V5_WEIGHTS.bishopPair;
  baseScore += passers * STONEFISH_V5_WEIGHTS.passedPawn;
  baseScore += stonefishV5ProRecoveryPasserStatus(game, c.ourPassers, perspective, perspective);
  baseScore += stonefishV5ProRecoveryPasserStatus(game, c.theirPassers, enemy, perspective);

  stonefishV5ProRecoveryCacheSet(
    STONEFISH_V5_PRO_ROOT_FUSION_BASE_CACHE,
    key,
    baseScore
  );

  let score = baseScore;
  score += mobility * (2 + c.attack * 2.5 + c.defence * 1.5);
  score += development * (9 * c.opening);
  score += kingProtection * (5 + 18 * c.defence + 8 * c.attack);
  score += kingFreedom * (3 + 10 * c.endgame);
  score += kingPlacement * (5 + 17 * c.endgame);
  score += boardControl * (1.5 + 4 * c.attack);
  score += passers * (18 + 45 * c.endgame + 65 * c.pawnRace);
  score += stonefishV5ProLooseAndCoordination(game, perspective) * (1.0 + 0.35 * c.defence);
  score += stonefishV5ProRayTactics(game, perspective) * (1.0 + 0.55 * c.attack);
  score += (c.attackPressure - c.defencePressure) * (24 + 22 * c.attack + 18 * c.defence);

  if (c.conversion > 0) {
    score -= enemyMobility * 2.5 * c.conversion;
    score += c.lead * 0.18 * c.conversion;
  }

  STONEFISH_V5_PRO_RECOVERY_ACTIVE_ATTACK_MEMO = previousMemo;
  return stonefishV5ProRecoveryCacheSet(
    STONEFISH_V5_PRO_RECOVERY_ADAPTIVE_CACHE,
    key,
    score
  );
};

function stonefishV5ProRootFusionBasePositionScore(game, perspective) {
  const key = stonefishV5ProRootFusionKey(game, perspective);
  let score = STONEFISH_V5_PRO_ROOT_FUSION_BASE_CACHE.get(key);
  if (score !== undefined) return score;
  stonefishV5ProAdaptivePosition(game, perspective);
  score = STONEFISH_V5_PRO_ROOT_FUSION_BASE_CACHE.get(key);
  return score;
}

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

function stonefishV5ProRootFusionCounterplay(replies, checks, c) {
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
  const baseScore = stonefishV5ProRootFusionBasePositionScore(game, perspective);
  const counterplay = stonefishV5ProRootFusionCounterplay(replies, checks, c);
  const enemyThreat = stonefishV5ProRecoveryPasserDanger(c.theirPassers);

  points += baseScore * STONEFISH_V5_WEIGHTS.positional;
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
