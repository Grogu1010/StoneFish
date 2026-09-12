// Stonefish_v5 tuning pass 6 — points-only conversion tuning.
// No deeper search is added. v5 keeps the same tactical horizon and improves
// only how simultaneous root signals are weighted.
STONEFISH_V5_WEIGHTS.heritage = 1500;
STONEFISH_V5_WEIGHTS.repetition = 200000;
STONEFISH_V5_WEIGHTS.repetitionAhead = 300000;

const STONEFISH_V5_DRAW_FLOOR = -STONEFISH_V5_MATE * 0.55;
const stonefishV5TacticalScoreBase = stonefishV5TacticalScore;
const stonefishV5PositionScoreBase = stonefishV5PositionScore;
const stonefishV5RootKnowledgeBase = stonefishV5RootKnowledge;

function stonefishV5PromotionUrgency(game, side) {
  let score = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    if (game.boardState[sq] !== side) continue;
    const file = sq & 7;
    const rank = sq >> 3;
    const progress = side === 1 ? rank : 7 - rank;
    const distance = 7 - progress;

    // Only give the huge bonus to genuinely passed pawns. A pawn one square
    // from promotion is an emergency, not just another small positional term.
    let passed = true;
    for (let r = rank + side; r >= 0 && r < 8 && passed; r += side) {
      for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f += 1) {
        if (game.boardState[r * 8 + f] === -side) { passed = false; break; }
      }
    }
    if (!passed) continue;

    if (distance === 1) score += 2400;
    else if (distance === 2) score += 900;
    else if (distance === 3) score += 300;
    else if (distance === 4) score += 90;
    else score += Math.max(0, progress - 1) * 12;
  }
  return score;
}

stonefishV5PositionScore = function(game, perspective) {
  const base = stonefishV5PositionScoreBase(game, perspective);
  const own = stonefishV5PromotionUrgency(game, perspective);
  const enemy = stonefishV5PromotionUrgency(game, -perspective);
  // Enemy promotion danger is deliberately weighted slightly more strongly:
  // stopping a near-queen is more urgent than starting a slow pawn race.
  return base + own - enemy * 1.35;
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

  // Keep the proven pre-v5 decision pattern as one useful vote, but do not let
  // it dominate a promotion emergency. This remains a points signal, never a gate.
  if (heritageMove && stonefishV5SameMove(raw, heritageMove)) {
    game.fastApply(raw);
    const enemyUrgency = stonefishV5PromotionUrgency(game, game.side);
    game.fastUndo();
    const heritageScale = enemyUrgency >= 2000 ? 0.10 : enemyUrgency >= 700 ? 0.30 : enemyUrgency >= 250 ? 0.55 : 1.0;
    points += STONEFISH_V5_WEIGHTS.heritage * heritageScale;
  }

  return points;
};
