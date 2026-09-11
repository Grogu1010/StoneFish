// Stonefish_v2
// Priorities:
// 1. Always play mate in 1 when available.
// 2. Avoid any move that allows the opponent to mate in 1, whenever a safe legal move exists.
// 3. Otherwise minimise the highest-value piece the opponent can capture next move.
// Ties are broken randomly.

const STONEFISH_PIECE_VALUES = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 1000
};

const STONEFISH_V2_CACHE = new Map();
const STONEFISH_V2_CACHE_LIMIT = 50000;
const STONEFISH_REPLY_CACHE = new Map();
const STONEFISH_REPLY_CACHE_LIMIT = 100000;

function stonefishValueSignature(pieceValues) {
  return `p${pieceValues.p}|n${pieceValues.n}|b${pieceValues.b}|r${pieceValues.r}|q${pieceValues.q}`;
}

function stonefishCoreFen(game) {
  if (typeof game.fastPositionKey === 'function') return game.fastPositionKey();
  return game.fen().split(' ').slice(0, 4).join(' ');
}

function stonefishPositionKey(game, pieceValues) {
  return `${stonefishCoreFen(game)}|${stonefishValueSignature(pieceValues)}`;
}

function trimStonefishCache(cache, limit) {
  if (cache.size < limit) return;
  cache.delete(cache.keys().next().value);
}

function compactStonefishMove(move) {
  return {
    from: move.from,
    to: move.to,
    promotion: move.promotion || null,
    _raw: move._raw || null
  };
}

function cacheStonefishBestMoves(key, moves) {
  trimStonefishCache(STONEFISH_V2_CACHE, STONEFISH_V2_CACHE_LIMIT);
  STONEFISH_V2_CACHE.set(key, moves.map(compactStonefishMove));
}

function chooseRandomStonefishMove(moves) {
  if (!moves || moves.length === 0) return null;
  return moves[Math.floor(Math.random() * moves.length)];
}

function stonefishMoves(game) {
  if (typeof game.fastMoves === 'function') {
    return game.fastMoves().map(raw => ({
      from: game._alg(raw.from),
      to: game._alg(raw.to),
      promotion: raw.promotion || null,
      captured: raw.captured || null,
      _raw: raw
    }));
  }
  return game.moves({ verbose: true });
}

function stonefishApply(game, move) {
  if (typeof game.fastApply === 'function') return game.fastApply(move);
  return game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
}

function stonefishUndo(game) {
  if (typeof game.fastUndo === 'function') return game.fastUndo();
  return game.undo();
}

function stonefishMoveIsMate(game, move) {
  if (move.san && move.san.endsWith('#')) return true;
  if (typeof game.fastIsMateMove === 'function') return game.fastIsMateMove(move);
  stonefishApply(game, move);
  const mate = game.in_checkmate();
  stonefishUndo(game);
  return mate;
}

function getStonefishReplySummary(game) {
  const key = stonefishCoreFen(game);
  const cached = STONEFISH_REPLY_CACHE.get(key);
  if (cached) return cached;

  const replies = stonefishMoves(game);
  let allowsMateInOne = false;
  let captureMask = 0;
  const captureBits = { p: 1, n: 2, b: 4, r: 8, q: 16, k: 32 };

  for (const reply of replies) {
    if (!allowsMateInOne && stonefishMoveIsMate(game, reply)) allowsMateInOne = true;
    if (reply.captured) captureMask |= captureBits[reply.captured] || 0;
  }

  const summary = { allowsMateInOne, captureMask };
  trimStonefishCache(STONEFISH_REPLY_CACHE, STONEFISH_REPLY_CACHE_LIMIT);
  STONEFISH_REPLY_CACHE.set(key, summary);
  return summary;
}

function highestCaptureFromMask(captureMask, pieceValues) {
  let highest = 0;
  if (captureMask & 1) highest = Math.max(highest, pieceValues.p || 0);
  if (captureMask & 2) highest = Math.max(highest, pieceValues.n || 0);
  if (captureMask & 4) highest = Math.max(highest, pieceValues.b || 0);
  if (captureMask & 8) highest = Math.max(highest, pieceValues.r || 0);
  if (captureMask & 16) highest = Math.max(highest, pieceValues.q || 0);
  if (captureMask & 32) highest = Math.max(highest, pieceValues.k || 0);
  return highest;
}

function getStonefishV2MoveWithValues(game, pieceValues) {
  const cacheKey = stonefishPositionKey(game, pieceValues);
  const cachedMoves = STONEFISH_V2_CACHE.get(cacheKey);
  if (cachedMoves) return chooseRandomStonefishMove(cachedMoves);

  const legalMoves = stonefishMoves(game);
  if (legalMoves.length === 0) return null;

  const matingMoves = [];
  for (const move of legalMoves) {
    if (stonefishMoveIsMate(game, move)) matingMoves.push(move);
  }
  if (matingMoves.length > 0) {
    cacheStonefishBestMoves(cacheKey, matingMoves);
    return chooseRandomStonefishMove(matingMoves);
  }

  const scoredMoves = [];
  for (const move of legalMoves) {
    stonefishApply(game, move);
    const replySummary = getStonefishReplySummary(game);
    scoredMoves.push({
      move,
      allowsMateInOne: replySummary.allowsMateInOne,
      maxCaptureValue: highestCaptureFromMask(replySummary.captureMask, pieceValues)
    });
    stonefishUndo(game);
  }

  const safeMoves = scoredMoves.filter(candidate => !candidate.allowsMateInOne);
  const candidates = safeMoves.length > 0 ? safeMoves : scoredMoves;

  let lowestMaxCapture = Infinity;
  for (const candidate of candidates) {
    if (candidate.maxCaptureValue < lowestMaxCapture) lowestMaxCapture = candidate.maxCaptureValue;
  }

  const bestMoves = [];
  for (const candidate of candidates) {
    if (candidate.maxCaptureValue === lowestMaxCapture) bestMoves.push(candidate.move);
  }

  cacheStonefishBestMoves(cacheKey, bestMoves);
  return chooseRandomStonefishMove(bestMoves);
}

function getStonefishV2Move(game) {
  return getStonefishV2MoveWithValues(game, STONEFISH_PIECE_VALUES);
}
