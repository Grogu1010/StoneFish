// Stonefish_v4
// Built directly on Stonefish_v3. v3 decides mate safety and three-ply material first.
// Only moves tied by v3 reach these positional tie-breakers, in this tested order:
// 1. Give check.
// 2. Keep many legal movement options.
// 3. Avoid king suffocation, strongly preferring castling.
// 4. Keep protection around the king.
// 5. Control the centre.

const STONEFISH_V4_ORDER = ['check', 'mobility', 'kingFreedom', 'kingProtection', 'center'];
const STONEFISH_V4_CENTER = [27, 28, 35, 36]; // d4, e4, d5, e5

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

  // Do not let the king count as its own defender.
  b[king] = 0;

  for (let i = 0; i < SF_ALL_DIRS.length; i += 2) {
    const f = file + SF_ALL_DIRS[i];
    const r = rank + SF_ALL_DIRS[i + 1];
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;

    const sq = r * 8 + f;
    const piece = b[sq];
    if (piece && (piece > 0 ? 1 : -1) === side) {
      score += Math.abs(piece) === 1 ? 3 : 2;
    }
    if (game._isAttacked(sq, side)) score += 1;
  }

  b[king] = kingPiece;
  return score;
}

function stonefishV4CenterControl(game, side) {
  let score = 0;
  const b = game.boardState;

  for (let i = 0; i < STONEFISH_V4_CENTER.length; i += 1) {
    const sq = STONEFISH_V4_CENTER[i];
    const piece = b[sq];
    if (piece && (piece > 0 ? 1 : -1) === side) score += 2;
    if (game._isAttacked(sq, side)) score += 1;
  }

  return score;
}

function stonefishV4CriterionScore(game, raw, criterion) {
  if (criterion === 'check') return game.fastGivesCheck(raw) ? 1 : 0;

  game.fastApply(raw);
  const ownSide = -game.side;
  let score = 0;

  if (criterion === 'kingFreedom') {
    // If v3 considers castling materially equal to another move, castle first.
    const castlingBonus = raw.flags & (4 | 8) ? 100 : 0;
    score = castlingBonus + stonefishV4KingFreedom(game, ownSide);
  } else if (criterion === 'kingProtection') {
    score = stonefishV4KingProtection(game, ownSide);
  } else if (criterion === 'mobility') {
    score = game.fastMobility(ownSide);
  } else if (criterion === 'center') {
    score = stonefishV4CenterControl(game, ownSide);
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
