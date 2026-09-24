// Stonefish_v4.js
// Stonefish_v4
// Built directly on Stonefish_v3. v3 decides mate safety and three-ply material first.
// Only moves tied by v3 reach these same-depth lexicographic tie-breakers.
// No extra search ply is added here.
//
// Tested order:
// 1. Prefer the strongest promotion.
// 2. Castle immediately when v3 says it is materially tied.
// 3. Develop minor pieces in the opening.
// 4. Avoid leaving a high-value own piece hanging.
// 5. When ahead by 2.5+ material, avoid revisiting an already-seen position.
// 6. Maximise our legal movement options.
// 7. Keep the queen home early when development is still underway.
// 8. Prefer less-repeated positions, then reset the 50-move clock when useful.
// 9. Apply endgame pawn/check rules and positional coordination tie-breakers.

const STONEFISH_V4_VALUES = [0, 1, 3, 3.1, 5, 9, 0];
const STONEFISH_V4_CENTER = [27, 28, 35, 36]; // d4, e4, d5, e5
const STONEFISH_V4_REPEAT_LEAD = 2.5;
const STONEFISH_V4_ORDER = [
  'promotion',
  'castleNow',
  'openingDevelop',
  'hangingMax',
  'repetitionLeadGuard',
  'mobility',
  'queenDiscipline',
  'repetitionAvoid',
  'fiftyReset',
  'endgamePawnProgress',
  'endgameCheck',
  'pieceSupport',
  'kingFreedom',
  'center',
  'minorCentral',
  'kingProtection',
  'pawnStructure',
  'rookActivity',
  'kingPlacement',
  'boardControl'
];

function stonefishV4Material(game, side) {
  let score = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    const piece = game.boardState[sq];
    if (piece && (piece > 0 ? 1 : -1) === side) {
      score += STONEFISH_V4_VALUES[Math.abs(piece)] || 0;
    }
  }
  return score;
}

function stonefishV4IsEndgame(game, side) {
  return stonefishV4Material(game, side) <= 10;
}

function stonefishV4Development(game, side) {
  const b = game.boardState;
  const knightHomes = side === 1 ? [1, 6] : [57, 62];
  const bishopHomes = side === 1 ? [2, 5] : [58, 61];
  let score = 0;

  for (let sq = 0; sq < 64; sq += 1) {
    if (b[sq] === side * 2 && sq !== knightHomes[0] && sq !== knightHomes[1]) score += 2;
    if (b[sq] === side * 3 && sq !== bishopHomes[0] && sq !== bishopHomes[1]) score += 2;
  }
  return score;
}

function stonefishV4KingFreedom(game, side) {
  const b = game.boardState;
  const king = game.kingSq[side];
  const file = king & 7;
  const rank = king >> 3;
  const kingPiece = b[king];
  let freedom = 0;

  for (let i = 0; i < SF_ALL_DIRS.length; i += 2) {
    const f = file + SF_ALL_DIRS[i];
    const r = rank + SF_ALL_DIRS[i + 1];
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;

    const to = r * 8 + f;
    const target = b[to];
    if (target && (target > 0 ? 1 : -1) === side) continue;

    b[king] = 0;
    b[to] = kingPiece;
    const safe = !game._isAttacked(to, -side);
    b[king] = kingPiece;
    b[to] = target;
    if (safe) freedom += 1;
  }
  return freedom;
}

function stonefishV4KingProtection(game, side) {
  const b = game.boardState;
  const king = game.kingSq[side];
  const file = king & 7;
  const rank = king >> 3;
  const kingPiece = b[king];
  let score = 0;

  b[king] = 0;
  for (let i = 0; i < SF_ALL_DIRS.length; i += 2) {
    const f = file + SF_ALL_DIRS[i];
    const r = rank + SF_ALL_DIRS[i + 1];
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;

    const sq = r * 8 + f;
    const piece = b[sq];
    if (piece && (piece > 0 ? 1 : -1) === side) score += Math.abs(piece) === 1 ? 3 : 2;
    if (game._isAttacked(sq, side)) score += 1;
  }
  b[king] = kingPiece;
  return score;
}

function stonefishV4CenterControl(game, side) {
  let score = 0;
  for (let i = 0; i < STONEFISH_V4_CENTER.length; i += 1) {
    const sq = STONEFISH_V4_CENTER[i];
    const piece = game.boardState[sq];
    if (piece && (piece > 0 ? 1 : -1) === side) score += 2;
    if (game._isAttacked(sq, side)) score += 1;
  }
  return score;
}

function stonefishV4MinorCentralization(game, side) {
  let score = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    const piece = game.boardState[sq];
    if (piece !== side * 2 && piece !== side * 3) continue;
    const file = sq & 7;
    const rank = sq >> 3;
    if (STONEFISH_V4_CENTER.includes(sq)) score += 4;
    else if (file >= 2 && file <= 5 && rank >= 2 && rank <= 5) score += 2;
    else if (!(file === 0 || file === 7 || rank === 0 || rank === 7)) score += 1;
  }
  return score;
}

function stonefishV4PawnStructure(game, side) {
  const counts = new Array(8).fill(0);
  for (let sq = 0; sq < 64; sq += 1) {
    if (game.boardState[sq] === side) counts[sq & 7] += 1;
  }

  let score = 0;
  for (let file = 0; file < 8; file += 1) {
    if (counts[file] > 1) score -= 2 * (counts[file] - 1);
    if (counts[file] && (file === 0 || !counts[file - 1]) && (file === 7 || !counts[file + 1])) score -= 1;
  }
  return score;
}

function stonefishV4RookActivity(game, side) {
  const b = game.boardState;
  let score = 0;

  for (let sq = 0; sq < 64; sq += 1) {
    if (b[sq] !== side * 4) continue;
    const file = sq & 7;
    const rank = sq >> 3;
    let ownPawn = false;
    for (let r = 0; r < 8; r += 1) {
      if (b[r * 8 + file] === side) ownPawn = true;
    }
    if (!ownPawn) score += 2;
    if ((side === 1 && rank === 6) || (side === -1 && rank === 1)) score += 2;
  }
  return score;
}

function stonefishV4KingPlacement(game, side) {
  const king = game.kingSq[side];
  const file = king & 7;
  const rank = king >> 3;

  if (stonefishV4IsEndgame(game, side)) {
    return 7 - Math.abs(file - 3.5) - Math.abs(rank - 3.5);
  }

  const queenCastle = side === 1 ? 2 : 58;
  const kingCastle = side === 1 ? 6 : 62;
  const home = side === 1 ? 4 : 60;
  if (king === queenCastle || king === kingCastle) return 3;
  return king === home ? 1 : 0;
}

function stonefishV4EndgamePawnProgress(game, side) {
  if (!stonefishV4IsEndgame(game, side)) return 0;
  let score = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    if (game.boardState[sq] !== side) continue;
    const rank = sq >> 3;
    score += side === 1 ? rank - 1 : 6 - rank;
  }
  return score;
}

function stonefishV4BoardControl(game, side) {
  let score = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    if (game._isAttacked(sq, side)) score += 1;
  }
  return score;
}

function stonefishV4HangingMax(game, side) {
  let maxValue = 0;
  for (let sq = 0; sq < 64; sq += 1) {
    const piece = game.boardState[sq];
    if (!piece || (piece > 0 ? 1 : -1) !== side || Math.abs(piece) === 6) continue;
    const attacked = game._isAttacked(sq, -side);
    const defended = game._isAttacked(sq, side);
    if (attacked && !defended) maxValue = Math.max(maxValue, STONEFISH_V4_VALUES[Math.abs(piece)] || 0);
  }
  return -maxValue;
}

function stonefishV4RepetitionLeadGuard(game, raw) {
  game.fastApply(raw);
  const ownSide = -game.side;
  const previousVisits = game.positionCounts.get(game.fastPositionKey()) || 0;
  const lead = stonefishV4Material(game, ownSide) - stonefishV4Material(game, -ownSide);
  game.fastUndo();

  // The candidate receives a lower score only when it revisits a position while
  // Stonefish is materially ahead enough that repeating is a conversion mistake.
  return previousVisits >= 1 && lead >= STONEFISH_V4_REPEAT_LEAD ? 0 : 1;
}

function stonefishV4CriterionScore(game, raw, criterion) {
  if (criterion === 'promotion') return raw.promotion || 0;
  if (criterion === 'castleNow') return raw.flags & (4 | 8) ? 1 : 0;
  if (criterion === 'check') return game.fastGivesCheck(raw) ? 1 : 0;
  if (criterion === 'fiftyReset') return game.halfmove >= 60 && (raw.piece === 1 || raw.captured) ? 1 : 0;
  if (criterion === 'repetitionLeadGuard') return stonefishV4RepetitionLeadGuard(game, raw);

  game.fastApply(raw);
  const ownSide = -game.side;
  let score = 0;

  if (criterion === 'openingDevelop') {
    score = game.fullmove <= 13 ? stonefishV4Development(game, ownSide) : 0;
  } else if (criterion === 'hangingMax') {
    score = stonefishV4HangingMax(game, ownSide);
  } else if (criterion === 'mobility') {
    score = game.fastMobility(ownSide);
  } else if (criterion === 'queenDiscipline') {
    if (game.fullmove <= 10) {
      const queenHome = ownSide === 1 ? 3 : 59;
      score = game.boardState[queenHome] === ownSide * 5 ? 1 : 0;
    }
  } else if (criterion === 'repetitionAvoid') {
    score = -(game.positionCounts.get(game.fastPositionKey()) || 0);
  } else if (criterion === 'endgamePawnProgress') {
    score = stonefishV4EndgamePawnProgress(game, ownSide);
  } else if (criterion === 'endgameCheck') {
    score = stonefishV4IsEndgame(game, ownSide) && game.in_check() ? 1 : 0;
  } else if (criterion === 'pieceSupport') {
    score = game._isAttacked(raw.to, ownSide) ? 1 : 0;
  } else if (criterion === 'kingFreedom') {
    score = stonefishV4KingFreedom(game, ownSide);
  } else if (criterion === 'center') {
    score = stonefishV4CenterControl(game, ownSide);
  } else if (criterion === 'minorCentral') {
    score = stonefishV4MinorCentralization(game, ownSide);
  } else if (criterion === 'kingProtection') {
    score = stonefishV4KingProtection(game, ownSide);
  } else if (criterion === 'pawnStructure') {
    score = stonefishV4PawnStructure(game, ownSide);
  } else if (criterion === 'rookActivity') {
    score = stonefishV4RookActivity(game, ownSide);
  } else if (criterion === 'kingPlacement') {
    score = stonefishV4KingPlacement(game, ownSide);
  } else if (criterion === 'boardControl') {
    score = stonefishV4BoardControl(game, ownSide);
  }

  game.fastUndo();
  return score;
}

function stonefishV4BestByCriterion(game, candidates, criterion) {
  if (candidates.length <= 1) return candidates;

  let best = -Infinity;
  const scores = new Array(candidates.length);
  for (let i = 0; i < candidates.length; i += 1) {
    const score = stonefishV4CriterionScore(game, candidates[i], criterion);
    scores[i] = score;
    if (score > best) best = score;
  }

  const kept = [];
  for (let i = 0; i < candidates.length; i += 1) {
    if (scores[i] === best) kept.push(candidates[i]);
  }
  return kept;
}

function getStonefishV4MoveWithOrder(game, order) {
  let candidates = getStonefishV3BestRawMoves(game).slice();
  if (!candidates.length) return null;

  for (let i = 0; i < order.length && candidates.length > 1; i += 1) {
    candidates = stonefishV4BestByCriterion(game, candidates, order[i]);
  }

  const raw = stonefishV3RandomRaw(candidates);
  return raw ? stonefishV3PublicMove(game, raw) : null;
}

function getStonefishV4Move(game) {
  return getStonefishV4MoveWithOrder(game, STONEFISH_V4_ORDER);
}
