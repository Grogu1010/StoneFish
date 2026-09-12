// Stonefish_v5 tuning pass 7 — points-only conversion tuning.
// No extra ply/search depth is added. Every improvement below is a root score.
STONEFISH_V5_WEIGHTS.heritage = 1500;
STONEFISH_V5_WEIGHTS.repetition = 200000;
STONEFISH_V5_WEIGHTS.repetitionAhead = 300000;

const STONEFISH_V5_DRAW_FLOOR = -STONEFISH_V5_MATE * 0.55;
const stonefishV5TacticalScoreBase = stonefishV5TacticalScore;
const stonefishV5PositionScoreBase = stonefishV5PositionScore;
const stonefishV5RootKnowledgeBase = stonefishV5RootKnowledge;

function stonefishV5PassedPawnInfo(game, side) {
  const passers = [];
  for (let sq = 0; sq < 64; sq += 1) {
    if (game.boardState[sq] !== side) continue;
    const file = sq & 7;
    const rank = sq >> 3;
    let passed = true;
    for (let r = rank + side; r >= 0 && r < 8 && passed; r += side) {
      for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f += 1) {
        if (game.boardState[r * 8 + f] === -side) { passed = false; break; }
      }
    }
    if (!passed) continue;
    const progress = side === 1 ? rank : 7 - rank;
    passers.push({ sq, file, rank, progress, distance: 7 - progress });
  }
  return passers;
}

function stonefishV5PasserDanger(distance) {
  if (distance <= 1) return 5200;
  if (distance === 2) return 2200;
  if (distance === 3) return 900;
  if (distance === 4) return 360;
  if (distance === 5) return 140;
  return 35;
}

function stonefishV5PasserStatus(game, pawnSide, perspective) {
  let score = 0;
  const passers = stonefishV5PassedPawnInfo(game, pawnSide);
  const ours = pawnSide === perspective;
  const blockerSide = -pawnSide;

  for (const passer of passers) {
    const danger = stonefishV5PasserDanger(passer.distance);
    let effective = danger;
    const nextSq = passer.sq + pawnSide * 8;

    if (nextSq >= 0 && nextSq < 64) {
      const nextPiece = game.boardState[nextSq];
      if (nextPiece && (nextPiece > 0 ? 1 : -1) === blockerSide) effective *= 0.18;
      else if (game._isAttacked(nextSq, blockerSide)) effective *= 0.58;
    }

    // A rook, queen or king stationed in front of the passer on the same file
    // is a real blockade even if it is several squares away.
    for (let r = passer.rank + pawnSide; r >= 0 && r < 8; r += pawnSide) {
      const p = game.boardState[r * 8 + passer.file];
      if (!p) continue;
      if ((p > 0 ? 1 : -1) === blockerSide) {
        const type = Math.abs(p);
        if (type === 4 || type === 5 || type === 6) effective *= 0.42;
      }
      break;
    }

    // Direct pressure on the pawn itself is also valuable.
    if (game._isAttacked(passer.sq, blockerSide)) effective *= 0.72;

    score += ours ? effective : -effective * 1.35;
  }
  return score;
}

function stonefishV5EnemyPasserThreat(game, perspective) {
  let max = 0;
  for (const passer of stonefishV5PassedPawnInfo(game, -perspective)) {
    max = Math.max(max, stonefishV5PasserDanger(passer.distance));
  }
  return max;
}

stonefishV5PositionScore = function(game, perspective) {
  return stonefishV5PositionScoreBase(game, perspective)
    + stonefishV5PasserStatus(game, perspective, perspective)
    + stonefishV5PasserStatus(game, -perspective, perspective);
};

stonefishV5TacticalScore = function(game, raw) {
  if (game.fastIsMateMove(raw)) return STONEFISH_V5_MATE * 2;

  let score = stonefishV5TacticalScoreBase(game, raw);
  if (score >= STONEFISH_V5_MATE) score = STONEFISH_V5_MATE * 0.5;
  if (score <= -STONEFISH_V5_MATE) return -STONEFISH_V5_MATE;

  game.fastApply(raw);
  const rootVisits = game.positionCounts.get(game.fastPositionKey()) || 0;
  if (rootVisits > 0) {
    score -= rootVisits * 1200000;
    score = Math.max(score, STONEFISH_V5_DRAW_FLOOR);
  }

  const replies = game.fastMoves();
  for (let i = 0; i < replies.length; i += 1) {
    game.fastApply(replies[i]);
    const priorVisits = game.positionCounts.get(game.fastPositionKey()) || 0;
    game.fastUndo();
    if (priorVisits >= 2) {
      score = Math.min(score, STONEFISH_V5_DRAW_FLOOR);
      break;
    }
  }
  game.fastUndo();
  return score;
};

stonefishV5RootKnowledge = function(game, raw, heritageMove, bookMove, perspective) {
  let points = stonefishV5RootKnowledgeBase(game, raw, null, bookMove, perspective);

  // The pre-v5 choice is still useful, but the new architecture takes control
  // when a dangerous passed pawn exists. This is a weighted vote, never a gate.
  if (heritageMove && stonefishV5SameMove(raw, heritageMove)) {
    game.fastApply(raw);
    const enemyThreat = stonefishV5EnemyPasserThreat(game, perspective);
    game.fastUndo();
    const heritageScale = enemyThreat >= 300 ? 0 : enemyThreat >= 120 ? 0.18 : enemyThreat >= 35 ? 0.60 : 1.0;
    points += STONEFISH_V5_WEIGHTS.heritage * heritageScale;
  }

  return points;
};
