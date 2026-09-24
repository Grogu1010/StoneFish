// Stonefish_v5.js
// Stonefish_v5 — unified points architecture.
//
// Unlike v4/v4.5, v5 never walks a lexicographic "if tied, ask the next question"
// chain. Every legal move is evaluated at once and receives one total score.
//
// v5 combines:
// - three-ply tactical safety for EVERY legal move (not a v3 candidate gate),
// - a weighted positional scorecard,
// - v4.5 opening and mating-pattern knowledge as points,
// - immediate opponent-check and opponent-mobility restriction from move one,
// - conversion pressure against repetition and the 50-move rule.

const STONEFISH_V5_MATE = 10000000;
const STONEFISH_V5_PIECE = [0, 100, 320, 335, 510, 930, 0];
const STONEFISH_V5_CACHE = new Map();
const STONEFISH_V5_CACHE_LIMIT = 50000;

const STONEFISH_V5_WEIGHTS = {
  tactical: 1.0,
  positional: 0.55,
  mobility: 5,
  development: 12,
  center: 7,
  minorCentral: 5,
  kingProtection: 10,
  kingFreedom: 4,
  pawnStructure: 8,
  rookActivity: 6,
  kingPlacement: 8,
  boardControl: 2,
  hanging: 45,
  bishopPair: 20,
  passedPawn: 12,
  book: 115,
  castle: 42,
  check: 18,
  promotion: 90,
  matePattern: 6,
  oppCheckRisk: 30,
  oppMobility: 4,
  heritage: 150,
  repetition: 180,
  repetitionAhead: 520,
  fiftyReset: 55
};

function stonefishV5TrimCache() {
  while (STONEFISH_V5_CACHE.size > STONEFISH_V5_CACHE_LIMIT) {
    STONEFISH_V5_CACHE.delete(STONEFISH_V5_CACHE.keys().next().value);
  }
}

function stonefishV5SameMove(a, b) {
  const ar = a && a._raw ? a._raw : a;
  const br = b && b._raw ? b._raw : b;
  return !!ar && !!br && ar.from === br.from && ar.to === br.to && (ar.promotion || 0) === (br.promotion || 0);
}

function stonefishV5Material(game, side) {
  let total = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    const p = game.boardState[sq];
    if (p && (p > 0 ? 1 : -1) === side) total += STONEFISH_V5_PIECE[Math.abs(p)] || 0;
  }
  return total;
}

function stonefishV5BishopPair(game, side) {
  let count = 0;
  for (let sq = 0; sq < 64; sq += 1) if (game.boardState[sq] === side * 3) count += 1;
  return count >= 2 ? 1 : 0;
}

function stonefishV5PassedPawns(game, side) {
  const b = game.boardState;
  let score = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    if (b[sq] !== side) continue;
    const file = sq & 7;
    const rank = sq >> 3;
    let passed = true;
    for (let r = rank + side; r >= 0 && r < 8 && passed; r += side) {
      for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f += 1) {
        if (b[r * 8 + f] === -side) { passed = false; break; }
      }
    }
    if (passed) score += Math.max(0, side === 1 ? rank - 1 : 6 - rank);
  }
  return score;
}

function stonefishV5PositionScore(game, perspective) {
  const key = perspective + '|' + game.fastPositionKey();
  const cached = STONEFISH_V5_CACHE.get(key);
  if (cached !== undefined) return cached;

  const enemy = -perspective;
  let score = stonefishV5Material(game, perspective) - stonefishV5Material(game, enemy);
  score += (game.fastMobility(perspective) - game.fastMobility(enemy)) * STONEFISH_V5_WEIGHTS.mobility;
  score += (stonefishV4Development(game, perspective) - stonefishV4Development(game, enemy)) * STONEFISH_V5_WEIGHTS.development;
  score += (stonefishV4CenterControl(game, perspective) - stonefishV4CenterControl(game, enemy)) * STONEFISH_V5_WEIGHTS.center;
  score += (stonefishV4MinorCentralization(game, perspective) - stonefishV4MinorCentralization(game, enemy)) * STONEFISH_V5_WEIGHTS.minorCentral;
  score += (stonefishV4KingProtection(game, perspective) - stonefishV4KingProtection(game, enemy)) * STONEFISH_V5_WEIGHTS.kingProtection;
  score += (stonefishV4KingFreedom(game, perspective) - stonefishV4KingFreedom(game, enemy)) * STONEFISH_V5_WEIGHTS.kingFreedom;
  score += (stonefishV4PawnStructure(game, perspective) - stonefishV4PawnStructure(game, enemy)) * STONEFISH_V5_WEIGHTS.pawnStructure;
  score += (stonefishV4RookActivity(game, perspective) - stonefishV4RookActivity(game, enemy)) * STONEFISH_V5_WEIGHTS.rookActivity;
  score += (stonefishV4KingPlacement(game, perspective) - stonefishV4KingPlacement(game, enemy)) * STONEFISH_V5_WEIGHTS.kingPlacement;
  score += (stonefishV4BoardControl(game, perspective) - stonefishV4BoardControl(game, enemy)) * STONEFISH_V5_WEIGHTS.boardControl;
  score += (stonefishV4HangingMax(game, perspective) - stonefishV4HangingMax(game, enemy)) * STONEFISH_V5_WEIGHTS.hanging;
  score += (stonefishV5BishopPair(game, perspective) - stonefishV5BishopPair(game, enemy)) * STONEFISH_V5_WEIGHTS.bishopPair;
  score += (stonefishV5PassedPawns(game, perspective) - stonefishV5PassedPawns(game, enemy)) * STONEFISH_V5_WEIGHTS.passedPawn;

  stonefishV5TrimCache();
  STONEFISH_V5_CACHE.set(key, score);
  return score;
}

function stonefishV5BestResponseGain(game, responses) {
  let best = 0;
  for (let i = 0; i < responses.length; i += 1) {
    const response = responses[i];
    if (game.fastIsMateMove(response)) return STONEFISH_V5_MATE;
    let gain = STONEFISH_V5_PIECE[response.captured] || 0;
    if (response.promotion) gain += (STONEFISH_V5_PIECE[response.promotion] || 0) - 100;
    if (game.fastGivesCheck(response)) gain += 18;
    if (gain > best) best = gain;
  }
  return best;
}

// v3-inspired three-ply tactical floor, but critically this scores EVERY root
// move instead of letting v3 eliminate all but its tied winners.
function stonefishV5TacticalScore(game, raw) {
  if (game.fastIsMateMove(raw)) return STONEFISH_V5_MATE;

  let immediate = STONEFISH_V5_PIECE[raw.captured] || 0;
  if (raw.promotion) immediate += (STONEFISH_V5_PIECE[raw.promotion] || 0) - 100;

  game.fastApply(raw);
  const replies = game.fastMoves();
  if (!replies.length) {
    const score = game.in_check() ? STONEFISH_V5_MATE : 0;
    game.fastUndo();
    return score;
  }

  let worst = Infinity;
  for (let i = 0; i < replies.length; i += 1) {
    const reply = replies[i];
    if (game.fastIsMateMove(reply)) {
      game.fastUndo();
      return -STONEFISH_V5_MATE;
    }

    let opponentGain = STONEFISH_V5_PIECE[reply.captured] || 0;
    if (reply.promotion) opponentGain += (STONEFISH_V5_PIECE[reply.promotion] || 0) - 100;
    if (game.fastGivesCheck(reply)) opponentGain += 14;

    game.fastApply(reply);
    const responses = game.fastMoves();
    const ourGain = stonefishV5BestResponseGain(game, responses);
    game.fastUndo();

    const branch = immediate - opponentGain + ourGain;
    if (branch < worst) worst = branch;
  }

  game.fastUndo();
  return worst;
}

// Internal v5 heritage signal. This preserves the strongest pre-v5 decision
// pattern without shipping a separate test model. It is only ONE weighted vote;
// unlike v4/v4.5 it never eliminates other root moves from consideration.
function stonefishV5HeritageMove(game) {
  let candidates = getStonefishV3BestRawMoves(game).slice();
  if (!candidates.length) return null;

  for (let i = 0; i < STONEFISH_V4_ORDER.length && candidates.length > 1; i += 1) {
    const criterion = STONEFISH_V4_ORDER[i];

    if (criterion === 'mobility') {
      const book = stonefishV45BookMove(game, 0, candidates);
      if (book) return stonefishV3PublicMove(game, book);

      candidates = stonefishV45BestByInverse(game, candidates, 'oppCheckRisk');
      if (candidates.length > 1) candidates = stonefishV45BestByInverse(game, candidates, 'oppMobility');
    }

    candidates = stonefishV4BestByCriterion(game, candidates, criterion);
    if (criterion === 'pieceSupport' && candidates.length > 1) {
      candidates = stonefishV45StrictPatternTieBreak(game, candidates);
    }
  }

  const raw = stonefishV3RandomRaw(candidates);
  return raw ? stonefishV3PublicMove(game, raw) : null;
}

function stonefishV5RootKnowledge(game, raw, heritageMove, bookMove, perspective) {
  let points = 0;
  if (heritageMove && stonefishV5SameMove(raw, heritageMove)) points += STONEFISH_V5_WEIGHTS.heritage;
  if (bookMove && stonefishV5SameMove(raw, bookMove)) points += STONEFISH_V5_WEIGHTS.book;
  if (raw.flags & (4 | 8)) points += STONEFISH_V5_WEIGHTS.castle;
  if (raw.promotion) points += STONEFISH_V5_WEIGHTS.promotion;
  if (game.fastGivesCheck(raw)) points += STONEFISH_V5_WEIGHTS.check;

  // Immediate inverse-pressure knowledge: restrict opponent checks and mobility
  // from move one as continuous points rather than hard filter stages.
  points += stonefishV45InverseScore(game, raw, 'oppCheckRisk') * STONEFISH_V5_WEIGHTS.oppCheckRisk;
  points += stonefishV45InverseScore(game, raw, 'oppMobility') * STONEFISH_V5_WEIGHTS.oppMobility;
  points += stonefishV45StrictPatternScore(game, raw) * STONEFISH_V5_WEIGHTS.matePattern;

  game.fastApply(raw);
  points += stonefishV5PositionScore(game, perspective) * STONEFISH_V5_WEIGHTS.positional;

  const ownSide = -game.side;
  const enemySide = game.side;
  const visits = game.positionCounts.get(game.fastPositionKey()) || 0;
  const lead = stonefishV5Material(game, ownSide) - stonefishV5Material(game, enemySide);
  if (visits > 0) {
    points -= visits * STONEFISH_V5_WEIGHTS.repetition;
    if (lead >= 200) points -= STONEFISH_V5_WEIGHTS.repetitionAhead;
  }
  if (game.halfmove >= 60 && (raw.piece === 1 || raw.captured)) points += STONEFISH_V5_WEIGHTS.fiftyReset;
  game.fastUndo();
  return points;
}

function stonefishV5ScoreAllMoves(game) {
  const legal = game.fastMoves();
  if (!legal.length) return [];
  const perspective = game.side;

  // The old strong decision pattern is retained only as a weighted signal.
  // Every legal root move remains eligible to beat it on the unified score.
  const heritageMove = stonefishV5HeritageMove(game);
  const bookMove = stonefishV45BookMove(game, 1, legal);
  const scored = new Array(legal.length);

  for (let i = 0; i < legal.length; i += 1) {
    const raw = legal[i];
    const tactical = stonefishV5TacticalScore(game, raw);
    const knowledge = Math.abs(tactical) >= STONEFISH_V5_MATE ? 0 : stonefishV5RootKnowledge(game, raw, heritageMove, bookMove, perspective);
    scored[i] = { raw, tactical, knowledge, score: tactical * STONEFISH_V5_WEIGHTS.tactical + knowledge };
  }

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
    const au = stonefishV45RawUci(game, a.raw);
    const bu = stonefishV45RawUci(game, b.raw);
    return au < bu ? -1 : au > bu ? 1 : 0;
  });
  return scored;
}

function getStonefishV5Move(game) {
  const scored = stonefishV5ScoreAllMoves(game);
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}

// Final v5 point tuning. This deliberately adds no extra search depth; it only
// changes simultaneous root scoring and static positional geometry.
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

function stonefishV5CoversPromotionAfterAdvance(game, passer, defenderSide) {
  if (passer.distance !== 1) return false;
  const promotionRank = game.boardState[passer.sq] > 0 ? 7 : 0;
  const promotionSq = promotionRank * 8 + passer.file;
  const pawn = game.boardState[passer.sq];
  game.boardState[passer.sq] = 0;
  const covered = game._isAttacked(promotionSq, defenderSide);
  game.boardState[passer.sq] = pawn;
  return covered;
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

    for (let r = passer.rank + pawnSide; r >= 0 && r < 8; r += pawnSide) {
      const p = game.boardState[r * 8 + passer.file];
      if (!p) continue;
      if ((p > 0 ? 1 : -1) === blockerSide) {
        const type = Math.abs(p);
        if (type === 4 || type === 5 || type === 6) effective *= 0.42;
      }
      break;
    }

    if (game._isAttacked(passer.sq, blockerSide)) effective *= 0.72;
    if (stonefishV5CoversPromotionAfterAdvance(game, passer, blockerSide)) effective *= 0.20;

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

  if (heritageMove && stonefishV5SameMove(raw, heritageMove)) {
    game.fastApply(raw);
    const enemyThreat = stonefishV5EnemyPasserThreat(game, perspective);
    game.fastUndo();
    const heritageScale = enemyThreat >= 300 ? 0 : enemyThreat >= 120 ? 0.18 : enemyThreat >= 35 ? 0.60 : 1.0;
    points += STONEFISH_V5_WEIGHTS.heritage * heritageScale;
  }

  return points;
};
