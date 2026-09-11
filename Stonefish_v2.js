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

// Value-independent cache for "what can the opponent do from here?".
// This is shared by v2 and both test units, because legal replies and captured
// piece TYPES are identical regardless of whether bishop/knight is worth 3.1.
const STONEFISH_REPLY_CACHE = new Map();
const STONEFISH_REPLY_CACHE_LIMIT = 100000;

function stonefishValueSignature(pieceValues) {
  return `p${pieceValues.p}|n${pieceValues.n}|b${pieceValues.b}|r${pieceValues.r}|q${pieceValues.q}`;
}

function stonefishCoreFen(game) {
  const fenParts = game.fen().split(' ');
  return fenParts.slice(0, 4).join(' ');
}

function stonefishPositionKey(game, pieceValues) {
  return `${stonefishCoreFen(game)}|${stonefishValueSignature(pieceValues)}`;
}

function trimStonefishCache(cache, limit) {
  if (cache.size < limit) return;
  const oldestKey = cache.keys().next().value;
  cache.delete(oldestKey);
}

function cacheStonefishBestMoves(key, moves) {
  trimStonefishCache(STONEFISH_V2_CACHE, STONEFISH_V2_CACHE_LIMIT);
  STONEFISH_V2_CACHE.set(key, moves.map(move => ({
    from: move.from,
    to: move.to,
    promotion: move.promotion || null
  })));
}

function chooseRandomStonefishMove(moves) {
  if (!moves || moves.length === 0) return null;
  return moves[Math.floor(Math.random() * moves.length)];
}

function getStonefishReplySummary(game) {
  const key = stonefishCoreFen(game);
  const cached = STONEFISH_REPLY_CACHE.get(key);
  if (cached) return cached;

  const replies = game.moves({ verbose: true });
  let allowsMateInOne = false;
  let captureMask = 0;

  // Bits: pawn 1, knight 2, bishop 4, rook 8, queen 16, king 32.
  const captureBits = { p: 1, n: 2, b: 4, r: 8, q: 16, k: 32 };

  for (const reply of replies) {
    if (!allowsMateInOne && reply.san && reply.san.endsWith('#')) {
      allowsMateInOne = true;
    }

    if (reply.captured) {
      captureMask |= captureBits[reply.captured] || 0;
    }
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

  if (cachedMoves) {
    return chooseRandomStonefishMove(cachedMoves);
  }

  const legalMoves = game.moves({ verbose: true });

  if (legalMoves.length === 0) {
    return null;
  }

  // chess.js already calculated SAN; '#' means mate in one.
  const matingMoves = [];
  for (const move of legalMoves) {
    if (move.san && move.san.endsWith('#')) matingMoves.push(move);
  }

  if (matingMoves.length > 0) {
    cacheStonefishBestMoves(cacheKey, matingMoves);
    return chooseRandomStonefishMove(matingMoves);
  }

  const scoredMoves = [];

  // Analyse directly on the supplied game and always undo before continuing.
  // This avoids allocating/copying a complete Chess instance every move.
  for (const move of legalMoves) {
    game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });

    const replySummary = getStonefishReplySummary(game);
    scoredMoves.push({
      move,
      allowsMateInOne: replySummary.allowsMateInOne,
      maxCaptureValue: highestCaptureFromMask(replySummary.captureMask, pieceValues)
    });

    game.undo();
  }

  const safeMoves = scoredMoves.filter(candidate => !candidate.allowsMateInOne);
  const candidates = safeMoves.length > 0 ? safeMoves : scoredMoves;

  let lowestMaxCapture = Infinity;
  for (const candidate of candidates) {
    if (candidate.maxCaptureValue < lowestMaxCapture) {
      lowestMaxCapture = candidate.maxCaptureValue;
    }
  }

  const bestMoves = [];
  for (const candidate of candidates) {
    if (candidate.maxCaptureValue === lowestMaxCapture) {
      bestMoves.push(candidate.move);
    }
  }

  cacheStonefishBestMoves(cacheKey, bestMoves);
  return chooseRandomStonefishMove(bestMoves);
}

function getStonefishV2Move(game) {
  return getStonefishV2MoveWithValues(game, STONEFISH_PIECE_VALUES);
}
